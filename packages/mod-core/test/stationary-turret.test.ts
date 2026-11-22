import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { ABILITY_PROJECTILES, PROJECTILE_DRAG } from "../src/ability-words"
import { abilityIssues, STATIONARY_MELEE } from "../src/creature-abilities"
import { readGeneratedCreature } from "../src/creature-contract"
import { AbilitySchema, EntitySchema, type Ability } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { saveProject } from "../src/project"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

/**
 * A real maker run, "a skeleton guard that stands on a tower and throws spears when players come near":
 * 1. a hostile creature that must not move (stationary, with its reason) was refused for speed 0 by the acceptance check, and was generated
 *    to chase its target and step back from it all the same;
 * 2. its thrown spear was aimed straight at the target, so it dropped to the ground short of a target at range (the game's own archers lift theirs).
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const base = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "guard", name: "塔上守卫", health: 30, speed: 0, attack_damage: 3, behavior: "hostile" as const }
const entityFile = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const gen = (input: Record<string, unknown>) => String(compileEntity({ ...base, model: fightingGolemDesign, ...input } as never)[entityFile])
const stationary = { reason: "守在塔顶，不下来" }
const thrower = (extra: Record<string, unknown> = {}, shot: Record<string, unknown> = {}): Ability =>
  AbilitySchema.parse({
    ...golemAbilities[0],
    id: "spear",
    name: "投矛",
    windup: 0.5,
    length: 1.2,
    facing: "track",
    hits: [{ type: "shot", at: 0.7, projectile: "arrow", speed: 1.6, forward: 0.5, up: 1.5, damage: 6, ...shot }],
    moves: [],
    events: [],
    start: { min_distance: 2, max_distance: 24, line_of_sight: true, cooldown: 2, weight: 1 },
    ...extra,
  })
const spear = thrower()
const sweep = AbilitySchema.parse(golemAbilities[0])

// ---- 1. a creature that stays where it is ----

test("a hostile creature at speed 0 with a stationary reason is accepted (the schema, the life answers and the acceptance check)", async () => {
  const document = { kind: "entity", name: "守卫", description: "", health: 30, speed: 0, attack_damage: 3, behavior: "hostile", model_asset_id: "00000000-0000-4000-8000-00000000a001", runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null }, stationary, abilities: [spear] }
  const { ModuleDocumentSchema } = await import("../src/workspace")
  expect(ModuleDocumentSchema.safeParse(document).success).toBe(true)
  const { reviewAsset } = await import("../src/acceptance")
  const asset = (value: unknown) => ({ id: "00000000-0000-4000-8000-00000000d001", module: "entity" as const, document: ModuleDocumentSchema.parse(value), dependencies: [] as string[] })
  const project = { mod_id: "specimens", entities: [], blocks: [], items: [], recipes: [], logic: [], workspace: { assets: [] } } as never
  const ruled = (value: unknown) => reviewAsset(project, asset(value), { insisted: true }).findings.map((finding) => finding.rule)
  expect(ruled(document)).not.toContain("chases_but_cannot_move")
  // Without the reason it is still a chaser that cannot move; a stationary one is not.
  expect(ruled({ ...document, stationary: null })).toContain("chases_but_cannot_move")
})

test("a stationary hostile creature with an ability walks nowhere: no chase, no wander, no step back, and it still turns to its target and starts its ability", () => {
  const standing = gen({ stationary, abilities: [spear] })
  expect(standing).not.toContain("getNavigation().moveTo")
  expect(standing).not.toContain("WaterAvoidingRandomStrollGoal")
  expect(standing).not.toContain("GroundWanderGoal")
  expect(standing).not.toContain("abilityBackOff")
  expect(standing).not.toContain("strafe(")
  // It faces its target every tick and then starts what can start.
  expect(standing).toContain("            abilityFace(target);\n            if (startAbility(target)) return;")
  expect(standing).toContain("private void abilityFace(LivingEntity target)")
  expect(standing).toContain("goalSelector.addGoal(1, new AbilityGoal());")
  expect(standing).toContain("private boolean startAbility(LivingEntity target)")
  // It does not walk (speed in the game is 0 whatever the document says) and a blow does not push it off its place.
  expect(standing).toContain(".add(Attributes.MOVEMENT_SPEED, 0)")
  expect(standing).toContain(".add(Attributes.KNOCKBACK_RESISTANCE, 1.0)")
  expect(readGeneratedCreature(standing, null).inner).toEqual([{ type: "AbilityGoal", holds: ["MOVE", "LOOK"], seeks: false, wheat: false, lured: false, swings: false, chases: false, starts: true, picks: null }])
  // Speed written as anything else is ignored for walking too.
  expect(gen({ stationary, speed: 0.3, abilities: [spear] })).toContain(".add(Attributes.MOVEMENT_SPEED, 0)")
  // The same creature that may walk is what it always was.
  const walking = gen({ speed: 0.25, abilities: [spear] })
  expect(walking).toContain("getNavigation().moveTo(target, 1.2);")
  expect(walking).toContain(".add(Attributes.MOVEMENT_SPEED, 0.25)")
  expect(walking).not.toContain("KNOCKBACK_RESISTANCE")
  expect(walking).not.toContain("abilityFace(target);\n            if (startAbility(target)) return;")
})

test("a stationary creature with its own movement goal does not move in it, and starts its ability from there", () => {
  const runtime = { spawn: null, explosion: null, movement: "leap", armor: 0, charging_armor: 0, texture_asset_id: null }
  const standing = gen({ runtime, stationary, abilities: [spear] })
  expect(standing).not.toContain("getNavigation().moveTo")
  expect(standing).not.toContain("setVelocity(dx / distance")
  expect(standing).toContain("if (abilityRunning()) return;\n            abilityFace(target);\n            if (startAbility(target)) return;")
  expect(standing).toContain("private final class RuntimeMovementGoal extends Goal")
  const walking = gen({ runtime, speed: 0.25, abilities: [spear] })
  expect(walking).toContain("moveTo(target, 1.0)")
  expect(walking).toContain("if (abilityRunning() || startAbility(target)")
})

test("a stationary creature never steps back into an ability's window", () => {
  const far = thrower({ start: { min_distance: 6, max_distance: 24, line_of_sight: true, cooldown: 2, weight: 1 } })
  expect(gen({ speed: 0.25, abilities: [far] })).toContain("abilityBackOff(target)")
  const standing = gen({ stationary, abilities: [far] })
  expect(standing).not.toContain("abilityBackOff")
  expect(standing).not.toContain("ABILITY_NEAR")
})

test("a stationary hostile creature whose abilities all end within a swing is told it only fights whoever comes to it; one with a shot or a long beam is not", () => {
  const rooted = (abilities: Ability[]) => abilityIssues({ name: "守卫", behavior: "hostile", stationary, abilities }, null)
  const melee = rooted([sweep])
  expect(melee.map((issue) => [issue.rule, issue.stops])).toContainEqual(["ability_reach", false])
  expect(melee.find((issue) => issue.text.includes("守在原地"))!.text).toContain("玩家不走到它身边，它什么也做不了")
  expect(rooted([sweep, spear]).filter((issue) => issue.text.includes("守在原地"))).toEqual([])
  const beam = AbilitySchema.parse({ ...sweep, hits: [{ type: "area", at: 0.7, shape: { type: "line", up: 1, length: STATIONARY_MELEE + 6, radius: 1, aim: "target" }, hits: "target", damage: 4, knockback: 0, effects: [] }] })
  expect(rooted([beam]).filter((issue) => issue.text.includes("守在原地"))).toEqual([])
  // One that may walk walks up to its target, and a creature that is not hostile has no ability to use.
  expect(abilityIssues({ name: "守卫", behavior: "hostile", abilities: [sweep] }, null).filter((issue) => issue.text.includes("守在原地"))).toEqual([])
})

test("the creature's words say it does not move and is not pushed away", async () => {
  const { CREATURE_LIFE_INSTRUCTIONS } = await import("../src/creature-life")
  expect(CREATURE_LIFE_INSTRUCTIONS).toContain("速度 speed 写 0 也行")
})

// ---- 2. a shot that falls ----

/** The generated `abilityArc`, run for real: the method is cut out of the generated class and compiled against the game's own `Vec3` and `Mth` (Mojang's names), with the JDK the game runs on. */
const HAS_RUN = hasTargetJavac(OFFICIAL)
async function aimed(cases: { flat: number; dy: number; speed: number; gravity: number }[]) {
  const method = /\n( {4}private Vec3 abilityArc\([\s\S]*?\n {4}\})\n/.exec(gen({ stationary, abilities: [spear] }))![1]!.replace("private Vec3 abilityArc", "static Vec3 abilityArc")
  const work = await mkdtemp(path.join(os.tmpdir(), "minemods-arc-"))
  roots.push(work)
  await writeFile(
    path.join(work, "Arc.java"),
    `import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec3;
public class Arc {
    static double flat;
    static double dy;
    static Vec3 abilityOffset(double up, double forward) { return new Vec3(flat, dy, 0.0); }
${method}
    public static void main(String[] args) {
        for (int index = 0; index + 3 < args.length; index += 4) {
            flat = Double.parseDouble(args[index]);
            dy = Double.parseDouble(args[index + 1]);
            Vec3 aim = abilityArc(0.0, 0.0, Double.parseDouble(args[index + 2]), Double.parseDouble(args[index + 3]));
            System.out.println(aim.x + " " + aim.y + " " + aim.z);
        }
    }
}
`,
  )
  // The class path is a hundred jars under a Chinese folder name: javac takes it whole from an argument file (read as UTF-8); the java launcher reads one in the
  // system's own code page, so the run starts from a small loader that reads the same list itself.
  const jars = (await readFile(path.join(process.env.MINEMODS_TARGET_CLASSPATH!, `${OFFICIAL}.txt`), "utf8")).split(/\r?\n/).filter(Boolean)
  await writeFile(path.join(work, "cp.txt"), `-cp\n"${jars.join(path.delimiter).replaceAll("\\", "/")}"\n`)
  await writeFile(path.join(work, "jars.txt"), `${jars.join("\n")}\n`)
  await writeFile(
    path.join(work, "Run.java"),
    `import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
public class Run {
    public static void main(String[] args) throws Exception {
        List<URL> urls = new ArrayList<>();
        urls.add(Path.of(args[0]).toUri().toURL());
        for (String jar : Files.readAllLines(Path.of(args[1]), StandardCharsets.UTF_8)) if (!jar.isBlank()) urls.add(Path.of(jar).toUri().toURL());
        URLClassLoader loader = new URLClassLoader(urls.toArray(new URL[0]), ClassLoader.getPlatformClassLoader());
        String[] rest = java.util.Arrays.copyOfRange(args, 3, args.length);
        loader.loadClass(args[2]).getMethod("main", String[].class).invoke(null, (Object) rest);
    }
}
`,
  )
  const tool = (name: string) => path.join(process.env.MINEMODS_JDK21!, "bin", process.platform === "win32" ? `${name}.exe` : name)
  const compiled = Bun.spawnSync([tool("javac"), "-proc:none", "-encoding", "UTF-8", "-d", work, `@${path.join(work, "cp.txt")}`, path.join(work, "Arc.java"), path.join(work, "Run.java")])
  expect(compiled.stderr.toString().split("\n").filter((line) => line.includes("error"))).toEqual([])
  const ran = Bun.spawnSync([tool("java"), "-cp", work, "Run", work, path.join(work, "jars.txt"), "Arc", ...cases.flatMap((value) => [value.flat, value.dy, value.speed, value.gravity].map(String))])
  return ran.stdout.toString().trim().split("\n").filter((line) => /^-?[\d.]/.test(line)).map((line) => line.split(" ").map(Number) as [number, number, number])
}

/** The game's own flight of a thrown projectile or an arrow, tick by tick: it moves by its velocity, keeps `PROJECTILE_DRAG` of it, then falls by its gravity. Its height where it has come `flat` blocks along. */
function heightAt(flat: number, direction: [number, number, number], speed: number, gravity: number) {
  const length = Math.hypot(...direction)
  let [vx, vy, vz] = direction.map((value) => (value / length) * speed) as [number, number, number]
  let x = 0
  let y = 0
  for (let tick = 0; tick < 1000; tick++) {
    const along = Math.hypot(vx, vz)
    if (x + along >= flat) return y + vy * ((flat - x) / along)
    x += along
    y += vy
    vx *= PROJECTILE_DRAG
    vz *= PROJECTILE_DRAG
    vy = vy * PROJECTILE_DRAG - gravity
  }
  return Number.NaN
}

const PLAYER_MIDDLE_HALF = 0.9

test("the projectiles that fall say how much (read from the game), and the fireballs fly straight", () => {
  expect(Object.fromEntries(Object.entries(ABILITY_PROJECTILES).map(([id, value]) => [id, value.gravity]))).toEqual({ arrow: 0.05, snowball: 0.03, small_fireball: 0, fireball: 0 })
  expect(PROJECTILE_DRAG).toBe(0.99)
})

test("only a shot that falls is aimed above its target: the others keep the aim they had", () => {
  const arrow = gen({ stationary, abilities: [spear] })
  expect(arrow).toContain("Vec3 aim = abilityArc(1.5, 0.5, 1.6, 0.05);")
  expect(arrow).toContain("private Vec3 abilityOffset(double up, double forward)")
  expect(arrow).toContain("private Vec3 abilityDirection(double up, double forward) { return abilityOffset(up, forward).normalize(); }")
  const snow = gen({ stationary, abilities: [thrower({}, { projectile: "snowball", damage: null, speed: 1.2 })] })
  expect(snow).toContain("Vec3 aim = abilityArc(1.5, 0.5, 1.2, 0.03);")
  const fire = gen({ stationary, abilities: [thrower({}, { projectile: "small_fireball", damage: null, speed: 1 })] })
  expect(fire).toContain("Vec3 aim = abilityDirection(1.5, 0.5);")
  expect(fire).not.toContain("abilityArc")
  expect(fire).not.toContain("abilityOffset")
  // A creature with no shot is generated as it was: the direction is returned ready.
  const beam = gen({ abilities: [AbilitySchema.parse({ ...sweep, hits: [{ type: "area", at: 0.7, shape: { type: "line", up: 1, length: 8, radius: 1, aim: "target" }, hits: "target", damage: 4, knockback: 0, effects: [] }] })] })
  expect(beam).toContain("private Vec3 abilityDirection(double up, double forward) {")
  expect(beam).not.toContain("abilityArc")
})

test.skipIf(!HAS_RUN)("a spear thrown from a tower at a target 3, 8 and 14 blocks away and many blocks below flies through the target's body, where a straight aim falls short", async () => {
  // Thrown from 1.5 above the feet of a guard standing 8 blocks over the ground; the target's middle is 0.9 above its feet.
  const dy = -(8 + 1.5) + 0.9
  const cases = [3, 8, 14].flatMap((flat) => [
    { flat, dy, speed: 1.6, gravity: 0.05 },
    { flat, dy, speed: 1.0, gravity: 0.05 },
    { flat, dy, speed: 1.2, gravity: 0.03 },
  ])
  const aims = await aimed(cases)
  expect(aims.length).toBe(cases.length)
  cases.forEach((value, index) => {
    const aim = aims[index]!
    // The aim leans toward the target, and never to the side.
    expect(aim[0]).toBeGreaterThan(0)
    expect(aim[2]).toBe(0)
    const miss = heightAt(value.flat, aim, value.speed, value.gravity) - value.dy
    expect({ case: value, miss: Math.abs(miss) < 0.15 }).toEqual({ case: value, miss: true })
    expect(Math.abs(miss)).toBeLessThan(PLAYER_MIDDLE_HALF)
    // Aimed straight at the middle of the target it would have missed the body at this range, or at least have fallen well short of the middle.
    const straight = heightAt(value.flat, [value.flat, value.dy, 0], value.speed, value.gravity) - value.dy
    expect(straight).toBeLessThan(-0.5)
  })
  // The far, fast arrow: the straight aim is out of the body altogether.
  expect(Math.abs(heightAt(14, [14, dy, 0], 1.0, 0.05) - dy)).toBeGreaterThan(PLAYER_MIDDLE_HALF)
  // Level ground and a target above: the same.
  const more = [
    { flat: 10, dy: 0, speed: 1.6, gravity: 0.05 },
    { flat: 20, dy: 3, speed: 1.6, gravity: 0.05 },
    { flat: 25, dy: -1, speed: 1.6, gravity: 0.05 },
  ]
  const others = await aimed(more)
  more.forEach((value, index) => expect(Math.abs(heightAt(value.flat, others[index]!, value.speed, value.gravity) - value.dy)).toBeLessThan(0.15))
  // A shot too slow to reach them at all is aimed straight at them, and one aimed at its own feet does not fly off.
  const slow = await aimed([{ flat: 30, dy: 0, speed: 0.1, gravity: 0.05 }])
  expect(slow[0]![1]).toBe(0)
})

test("the start distance is the straight distance, height counted, and the line of sight is the creature's own: a target 3 to 8 blocks out and well below, in its window, can start the shot", () => {
  const out = gen({ stationary, abilities: [thrower({ start: { min_distance: 2, max_distance: 24, line_of_sight: true, cooldown: 2, weight: 1 } })] })
  expect(out).toContain("double distance = distanceTo(target);")
  expect(out).toContain("case 0 -> distance >= 2.0 && distance <= 24.0 && hasLineOfSight(target);")
  // On a tower 8 blocks high: the target 3 and 8 blocks out is 8.5 and 11.3 blocks away, 14 blocks out 16.1, all in the window.
  const distances = [3, 8, 14].map((flat) => Math.hypot(flat, 8))
  distances.forEach((distance) => {
    expect(distance).toBeGreaterThanOrEqual(2)
    expect(distance).toBeLessThanOrEqual(24)
  })
})

// ---- the generated tree compiles ----

test.skipIf(!hasTargetJavac(OFFICIAL))("the generated tree of a stationary guard that throws an arrow and a snowball compiles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-turret-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const entity = EntitySchema.parse({
    ...sample.entities[0]!,
    speed: 0,
    stationary,
    abilities: [spear, thrower({ id: "snow", name: "雪球", start: { min_distance: 0, max_distance: 12, line_of_sight: false, cooldown: 3, weight: 1 } }, { projectile: "snowball", damage: null, speed: 1.2 })],
  })
  expect(entity.stationary).toEqual(stationary)
  const blueprint = {
    request: "做一只守在塔上扔矛的骷髅",
    style: { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" },
    questions: [],
    revision: 1,
    state: "confirmed" as const,
    entries: [
      { key: "model", kind: "model", title: "模型", brief: "说明", owner: "dragon", needs: [], out_of_scope: null, asset_id: entity.id },
      { key: "dragon", kind: "entity", title: "怪", brief: "一只怪", owner: null, needs: ["model"], out_of_scope: null, asset_id: null, tier: { level: "standard" as const, reason: "测试", by: "ai" as const } },
    ],
  }
  await saveProject(directory, { ...sample, entities: [entity], blueprint } as never, sample.revision)
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(directory, source, TEMPLATE)
  expect(built.findings.filter((finding) => finding.stops)).toEqual([])
  const compiled = (await compileTreeFor(OFFICIAL, source))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 360000)

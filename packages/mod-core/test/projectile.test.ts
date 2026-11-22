import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { particlePreview } from "../src/particle-preview"
import { projectileIssues, projectileSketch, skyPlaces } from "../src/ability-projectile"
import { ABILITY_INSTRUCTIONS, abilityIssues, abilityWords, aroundOffsets, boneIssues, placeSeed } from "../src/creature-abilities"
import { AbilitySchema, type Ability } from "../src/entity-runtime"
import { compileProjectiles, flightSource, projectileImpactNeeds } from "../src/common/projectiles"
import { abilityEffectIds } from "../src/effect-abilities"
import { abilityParticleIds } from "../src/ability-trails"
import { impactShakes, shakeExtended, shakesOf } from "../src/boss-look-words"
import { compileAbilities } from "../src/fabric/entity-abilities"
import { ARENA_ABILITY_INSTRUCTIONS } from "../src/arena"
import { boomerangAt, boomerangTicks, fallTicks, fanAim, flightPoints, flyStep, launchVelocity, returnTicks, scatter, stepBack, type Point } from "../src/projectile-flight"
import { PROJECTILE_INSTRUCTIONS, PROJECTILE_LIMITS } from "../src/projectile-words"
import type { TargetId } from "../src/target/ids"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { createTargetProjectileSample, lanceAbility, rainAbility, spearGolemDesign as spearSample, whirlAbilities } from "../script/target-projectile-sample"
import { fightingGolemDesign as golemSample } from "../script/data-gameplay-sample"
import { hasTargetJavac, targetJavac, targetJdkTool } from "./target-javac"

// The samples' models, as the model documents they are saved as.
const spearGolemDesign = spearSample as unknown as ModelDesign
const fightingGolemDesign = golemSample as unknown as ModelDesign

/**
 * Boss 能力 2 (投射物): the document's rules, the flight's arithmetic in TypeScript and in the generated Java agreeing point for point, what the pictures and the reviewer are told,
 * and the generated mod on all three targets (the whole tree compiled against each target's real class path). The real Gradle builds and servers are `script/target-projectile-check.ts`.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const parsed = (hit: Record<string, unknown>, extra: Record<string, unknown> = {}) => AbilitySchema.safeParse({ ...lanceAbility, ...extra, hits: [{ ...lanceAbility.hits[0], ...hit }] })
const messages = (result: ReturnType<typeof parsed>) => (result.success ? [] : result.error.issues.map((issue) => issue.message))

test("flight trails sample the middle of each interval and count the entire volley against the particle cap", () => {
  const trail = { particle: "flame", per_tick: 4, spread: 0 }
  const single = { ...rainAbility.hits[0], from: { sky: { over: "self", height: 10 } }, lifetime_ticks: 10, trail }
  const move = AbilitySchema.parse({ ...rainAbility, hits: [single], events: [] })
  const sketch = projectileSketch(move, 0, fightingGolemDesign)!
  const segment = sketch.flights[0]!.out
  const group = particlePreview(move, fightingGolemDesign, (sketch.tick + 1) / 20).groups[0]!
  expect(group.points).toHaveLength(4)
  group.points.forEach((point, n) => point.forEach((v, axis) =>
    expect(v).toBeCloseTo(segment[0]![axis]! + (segment[1]![axis]! - segment[0]![axis]!) * (n + 0.5) / 4)))
  expect(messages(parsed({ trail, lifetime_ticks: 160 })).join()).toContain("600")
})

test("a projectile expires on its configured flight tick", () => {
  const hit = { ...rainAbility.hits[0], lifetime_ticks: 2 }
  const ability = AbilitySchema.parse({ ...rainAbility, hits: [hit] })
  const sketch = projectileSketch(ability, 0, null)!
  expect(sketch.flights[0]!.out).toHaveLength(3)
  expect(sketch.flights[0]!.land).toBeNull()
  expect(AbilitySchema.safeParse({ ...rainAbility, hits: [{ ...hit, lifetime_ticks: 1201 }] }).success).toBe(false)
})

test("a homing preview curves toward a moving target and rejects a sky drop", () => {
  const points = flightPoints("straight", [0, 1, 0], [0, 1, 12], 1, 0, 0, 30, { strength: 0.3, range: 20 }).points
  expect(points.some(point => point[0] > 1)).toBe(true)
  expect(AbilitySchema.safeParse({ ...rainAbility, hits: [{ ...rainAbility.hits[0], homing: { strength: 0.3, range: 20 } }] }).success).toBe(false)
})

test("piercing and ricochets accept bounded whole counts", () => {
  const hit = { ...rainAbility.hits[0], pierce: 2, bounces: 1 }
  expect(AbilitySchema.safeParse({ ...rainAbility, hits: [hit] }).success).toBe(true)
  for (const change of [{ pierce: 17 }, { bounces: 9 }, { pierce: 0.5 }]) expect(AbilitySchema.safeParse({ ...rainAbility, hits: [{ ...hit, ...change }] }).success).toBe(false)
})

test("the document: what a thrown thing may be written with", () => {
  expect(parsed({}).success).toBe(true)
  expect(AbilitySchema.safeParse(rainAbility).success).toBe(true)
  for (const ability of whirlAbilities) expect(AbilitySchema.safeParse(ability).success).toBe(true)
  // From the sky only straight down, warned or not; never a fan.
  expect(messages(parsed({ from: { sky: { over: "target", height: 12 } }, path: "arc" })).join()).toContain('path:"straight"')
  expect(messages(parsed({ from: { sky: { over: "target", height: 12 } }, path: "straight", count: 3 })).join()).toContain("不写 count 和 spread")
  // A part of its own is one.
  expect(messages(parsed({ count: 2, spread: 20 })).join()).toContain("一次只能扔 1 件")
  expect(messages(parsed({ from: { sky: { over: { type: "around_target", count: 4, spread: 3 }, height: 12 } }, path: "straight", pin_seconds: 0, comes_back: undefined })).join()).toContain("一次只能扔 1 件")
  // An arc needs gravity; a loop and a return have none, come back by themselves and never stick.
  expect(messages(parsed({ gravity: 0 })).join()).toContain("要有重力")
  expect(messages(parsed({ path: "boomerang", gravity: 0 })).join()).toContain("不写 comes_back")
  expect(messages(parsed({ path: "return", gravity: 0, comes_back: undefined })).join()).toContain("不写 pin_seconds")
  expect(messages(parsed({ path: "return", gravity: 0.05, comes_back: undefined, pin_seconds: 0 })).join()).toContain("gravity 写 0")
  // A warning only from the sky; coming back not before the throw; knockback never a pull.
  expect(messages(parsed({ warn: { seconds: 0.5, look: "ring", color: "red" } })).join()).toContain("只有从天上落下来的东西能写预警")
  expect(messages(parsed({ comes_back: { at: 0.2 } })).join()).toContain("不能比扔出去")
  expect(parsed({ knockback: -0.5 }).success).toBe(false)
  // Nothing is laid on where it lands, nor along it.
  const marked = AbilitySchema.safeParse({ ...lanceAbility, events: [{ type: "effect", at: 0.7, effect: "b2b2b2b2-0000-4000-8000-000000000001", where: "hit", hit: 0, forward: 0, up: 0, left: 0, count: 1, layout: "ring", spread: 0 }] })
  expect(messages(marked).join()).toContain("扔出去的东西")
})

test("the flight: arc lands exactly at the point it aims at, a return arrives there and comes home, a loop closes, a fan spreads evenly", () => {
  const from: Point = [0, 1.2, 0]
  const aim: Point = [3, 0, 9]
  let at = from
  let velocity = launchVelocity("arc", from, aim, 1, 0.05)
  const ticks = Math.ceil(Math.hypot(3, 9) / 1)
  for (let tick = 0; tick < ticks; tick++) ({ at, velocity } = flyStep(at, velocity, 0.05))
  at.forEach((value, axis) => expect(value).toBeCloseTo(aim[axis]!, 9))
  const out = returnTicks(from, aim, 1.2)
  const leave = launchVelocity("return", from, aim, 1.2, 0)
  leave.forEach((value, axis) => expect(from[axis]! + value * out).toBeCloseTo(aim[axis]!, 9))
  const total = boomerangTicks(from, aim, 0.8)
  boomerangAt(from, aim, total, total).forEach((value, axis) => expect(value).toBeCloseTo(from[axis]!, 9))
  boomerangAt(from, aim, total / 2, total).forEach((value, axis) => expect(value).toBeCloseTo(aim[axis]!, 9))
  expect(stepBack([0, 0, 0], [0, 0, 0.5], 1)).toEqual({ at: [0, 0, 0.5], home: true })
  const fan = [0, 1, 2].map((index) => fanAim(from, [0, 0, 10], index, 3, 40))
  expect(Math.atan2(fan[0]![0], fan[0]![2]) * (180 / Math.PI)).toBeCloseTo(20, 9)
  expect(Math.atan2(fan[2]![0], fan[2]![2]) * (180 / Math.PI)).toBeCloseTo(-20, 9)
  expect(fan[1]).toEqual([0, 0, 10])
  // The places of a scattered volley are item 3's places, number for number.
  const offsets = aroundOffsets(12, 6, placeSeed(PROJECTILE_LIMITS.seed, 0))
  const pairs = scatter(PROJECTILE_LIMITS.seed, 0, 12, 6)
  offsets.forEach((offset, index) => {
    expect(pairs[index * 2]).toBe(offset.forward)
    expect(pairs[index * 2 + 1]).toBe(offset.left)
  })
  const flown = flightPoints("straight", [0, 16, 0], [0, 0, 0], 0.5, 0.06, 0)
  expect(flown.land?.tick).toBe(fallTicks(16, 0.5, 0.06))
})

/** The flight's numbers for one set of inputs, as the TypeScript gives them: what the Java harness prints, line for line. */
function expected() {
  const lines: string[] = []
  const cases: [number, Point, Point, number, number][] = [
    [0, [0.5, 1.7, -2], [4, 1.1, 9.5], 1.4, 0.03],
    [1, [0.5, 1.7, -2], [-6, 0, 11], 0.9, 0.05],
    [1, [0, 2, 0], [0.2, 0, 0.3], 0.5, 0.08],
    [3, [1, 1, 1], [8, 2.5, -7], 1.1, 0],
    [0, [2, 16, -3], [2, 0, -3], 0.5, 0.06],
  ]
  const paths = ["straight", "arc", "boomerang", "return"] as const
  for (const [path, from, aim, speed, gravity] of cases) {
    let at = from
    let velocity = launchVelocity(paths[path]!, from, aim, speed, gravity)
    for (let tick = 0; tick < 30; tick++) {
      ;({ at, velocity } = flyStep(at, velocity, path === 3 ? 0 : gravity))
      lines.push(at.map((value) => value.toFixed(12)).join(" "))
    }
  }
  const total = boomerangTicks([0, 1, 0], [5, 1.5, 12], 0.8)
  for (let tick = 0; tick <= total; tick++) lines.push(boomerangAt([0, 1, 0], [5, 1.5, 12], tick, total).map((value) => value.toFixed(12)).join(" "))
  let back: Point = [9, 0, 9]
  for (let tick = 0; tick < 20; tick++) {
    const step = stepBack(back, [0, 1.5, 0], 0.9)
    back = step.at
    lines.push(`${back.map((value) => value.toFixed(12)).join(" ")} ${step.home ? 1 : 0}`)
  }
  for (let index = 0; index < 5; index++) lines.push(fanAim([1, 2, 3], [4, 0, 15], index, 5, 70).map((value) => value.toFixed(12)).join(" "))
  lines.push(String(fallTicks(16, 0.5, 0.06)), String(fallTicks(32, 0.1, 0)), String(returnTicks([1, 1, 1], [8, 2.5, -7], 1.1)))
  lines.push(scatter(20261114, 0, 12, 6).map((value) => value.toFixed(12)).join(" "), scatter(-7, 3, 5, 2.5).map((value) => value.toFixed(12)).join(" "))
  return lines
}

const harness = `import java.util.Locale;

public final class FlightHarness {
    static String row(double[] values, int count) {
        StringBuilder out = new StringBuilder();
        for (int index = 0; index < count; index++) out.append(index > 0 ? " " : "").append(String.format(Locale.ROOT, "%.12f", values[index] == 0.0 ? 0.0 : values[index]));
        return out.toString();
    }

    public static void main(String[] args) {
        Object[][] cases = {
            {0, new double[] {0.5, 1.7, -2}, new double[] {4, 1.1, 9.5}, 1.4, 0.03},
            {1, new double[] {0.5, 1.7, -2}, new double[] {-6, 0, 11}, 0.9, 0.05},
            {1, new double[] {0, 2, 0}, new double[] {0.2, 0, 0.3}, 0.5, 0.08},
            {3, new double[] {1, 1, 1}, new double[] {8, 2.5, -7}, 1.1, 0.0},
            {0, new double[] {2, 16, -3}, new double[] {2, 0, -3}, 0.5, 0.06},
        };
        for (Object[] one : cases) {
            int path = (Integer) one[0];
            double[] from = (double[]) one[1];
            double gravity = path == 3 ? 0.0 : (Double) one[4];
            double[] velocity = StudioFlight.velocity(path, from, (double[]) one[2], (Double) one[3], (Double) one[4]);
            double[] at = {from[0], from[1], from[2]};
            for (int tick = 0; tick < 30; tick++) {
                at = new double[] {at[0] + velocity[0], at[1] + velocity[1], at[2] + velocity[2]};
                velocity[1] -= gravity;
                System.out.println(row(at, 3));
            }
        }
        double[] start = {0, 1, 0};
        double[] end = {5, 1.5, 12};
        int total = StudioFlight.boomerangTicks(start, end, 0.8);
        for (int tick = 0; tick <= total; tick++) System.out.println(row(StudioFlight.boomerang(start, end, tick, total), 3));
        double[] back = {9, 0, 9};
        for (int tick = 0; tick < 20; tick++) {
            double[] next = StudioFlight.back(back, new double[] {0, 1.5, 0}, 0.9);
            back = new double[] {next[0], next[1], next[2]};
            System.out.println(row(back, 3) + " " + (next[3] > 0.5 ? 1 : 0));
        }
        for (int index = 0; index < 5; index++) System.out.println(row(StudioFlight.fan(new double[] {1, 2, 3}, new double[] {4, 0, 15}, index, 5, 70), 3));
        System.out.println(StudioFlight.fallTicks(16, 0.5, 0.06));
        System.out.println(StudioFlight.fallTicks(32, 0.1, 0));
        System.out.println(StudioFlight.returnTicks(new double[] {1, 1, 1}, new double[] {8, 2.5, -7}, 1.1));
        System.out.println(row(StudioFlight.scatter(20261114, 0, 12, 6), 24));
        System.out.println(row(StudioFlight.scatter(-7, 3, 5, 2.5), 10));
    }
}
`

test.skipIf(!hasTargetJavac("neoforge-1.21.1"))("the generated StudioFlight, run by a JDK, flies every point exactly where the TypeScript does", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-flight-"))
  roots.push(root)
  const flight = flightSource("flight.check").replace("package flight.check.entity;\n", "")
  await writeFile(path.join(root, "StudioFlight.java"), flight)
  await writeFile(path.join(root, "FlightHarness.java"), harness)
  const compiled = Bun.spawnSync([targetJdkTool("neoforge-1.21.1", "javac"), "-d", root, path.join(root, "StudioFlight.java"), path.join(root, "FlightHarness.java")])
  expect(compiled.stderr.toString()).toBe("")
  const ran = Bun.spawnSync([targetJdkTool("neoforge-1.21.1", "java"), "-cp", root, "FlightHarness"])
  // A number a hair under zero prints as -0 in both: the same point.
  const zero = (line: string) => line.replace(/-0\.000000000000(?![0-9])/g, "0.000000000000")
  const java = ran.stdout.toString().trim().split(/\r?\n/).map(zero)
  const mine = expected().map(zero)
  expect(java.length).toBe(mine.length)
  // Point for point to the twelfth decimal: the same double arithmetic in the same order (Math.sin and Math.cos may differ in the last bit, far below this).
  java.forEach((line, index) => expect(line).toBe(mine[index]!))
})

const EFFECT = "b2b2b2b2-0000-4000-8000-000000000002"
const PARTICLE = "b2b2b2b2-0000-4000-8000-0000000000aa"
const rained = (impact: unknown) => AbilitySchema.safeParse({ ...rainAbility, hits: [{ ...rainAbility.hits[0], impact }] })

test("落地炸开 (impact): what may be written, what it depends on, what it shakes, what is said of it", () => {
  // Every part alone, all together, and nothing at all (left out or null) as it always was.
  for (const impact of [{ effect: EFFECT }, { particle: "explosion" }, { particle: { asset: PARTICLE }, count: 24, spread: 3 }, { shake: { strength: 4, radius: 32, seconds: 1.5 } }, { effect: EFFECT, particle: "flame", count: 8, spread: 1, shake: { strength: 2, radius: 16, seconds: 1 } }, null, undefined])
    expect(rained(impact).success).toBe(true)
  // Something has to be in it; count and spread are the particles'; only what comes down bursts.
  expect(messages(rained({})).join()).toContain("至少写一样")
  expect(messages(rained({ effect: EFFECT, count: 4 })).join()).toContain("只有写了 particle 时才写")
  expect(messages(parsed({ path: "boomerang", gravity: 0, comes_back: undefined, pin_seconds: undefined, impact: { effect: EFFECT } })).join()).toContain("不写 impact")
  expect(messages(parsed({ path: "return", gravity: 0, comes_back: undefined, pin_seconds: undefined, impact: { effect: EFFECT } })).join()).toContain("不写 impact")
  expect(parsed({ impact: { effect: EFFECT } }).success).toBe(true)
  // Not a particle of the list, a number past its bounds, a field of no impact: refused by the schema.
  for (const impact of [{ particle: "heart_of_gold" }, { particle: "flame", count: 65 }, { particle: "flame", spread: 5 }, { shake: { strength: 9, radius: 32, seconds: 1 } }, { shake: { strength: 2, radius: 32 } }, { effect: "not-a-uuid" }, { effect: EFFECT, damage: 4 }])
    expect(rained(impact).success).toBe(false)

  // Its effect and its own particle are what the creature depends on (the workspace and the build read these), its shake is one of its shakes.
  const bursting = AbilitySchema.parse({ ...rainAbility, hits: [{ ...rainAbility.hits[0], look: { bone: "spear" }, from: { bone: "spear" }, warn: undefined, path: "arc", impact: { effect: "b2b2b2b2-0000-4000-8000-0000000000bb", particle: { asset: PARTICLE }, shake: { strength: 4, radius: 32, seconds: 1.5 } } }] })
  expect(abilityEffectIds([bursting])).toEqual(["b2b2b2b2-0000-4000-8000-0000000000bb"])
  expect(abilityParticleIds([bursting])).toEqual([PARTICLE])
  expect(abilityParticleIds([AbilitySchema.parse({ ...rainAbility, hits: [{ ...rainAbility.hits[0], impact: { particle: "explosion" } }] })])).toEqual([])
  expect(impactShakes(bursting)).toEqual([{ type: "shake", at: 1, strength: 4, radius: 32, seconds: 1.5 }])
  // Past the old cap, it gets the stronger shake's runtime as a shake event would.
  expect(shakesOf([bursting]).some(shakeExtended)).toBe(true)
  expect(shakesOf([rainAbility, lanceAbility])).toEqual([])
  expect(projectileImpactNeeds([bursting.hits[0] as never])).toEqual({ effects: true, own: true, shake: true, ground: false })
  expect(projectileImpactNeeds([rainAbility.hits[0] as never, lanceAbility.hits[0] as never])).toEqual({ effects: false, own: false, shake: false, ground: false })
  expect(projectileImpactNeeds([lanceAbility.hits[0] as never])).toBeNull()

  // A thrown thing without one is written as it always was: the same launch, the same classes as a project with no impact anywhere.
  const plain = AbilitySchema.parse({ ...rainAbility, hits: [{ ...rainAbility.hits[0], impact: undefined }] })
  const launch = (ability: Ability) => compileAbilities({ entity: "StudioCreature", model: "creature_x", abilities: [ability], hostile: true, runtime: true, death: false }).methods
  expect(launch(AbilitySchema.parse({ ...rainAbility, hits: [{ ...rainAbility.hits[0], impact: null }] }))).toBe(launch(plain))
  expect(launch(plain)).toContain(`"${EFFECT}", null), 0, 0.0, 0.0, 0.0, abilityYaw, 18, 1.0f);`)
  const input = { modId: "spear_camp", packageName: "com.minemods.content_spear_camp", effects: true, warned: true }
  expect(compileProjectiles({ ...input, impact: null }).files).toEqual(compileProjectiles(input).files)
  const bursts = compileProjectiles({ ...input, impact: { effects: true, own: true, shake: true } }).files
  const table = bursts["src/main/java/com/minemods/content_spear_camp/entity/StudioProjectiles.java"]!
  expect(table).toContain("public record Impact(String effect, ParticleOptions particle, String own, int count, double spread, float strength, float radius, int ticks) {}")
  expect(table).toContain("String effect, String bone, Impact impact) {")
  const entity = bursts["src/main/java/com/minemods/content_spear_camp/entity/StudioProjectile.java"]!
  expect(entity).toContain("                strike(point, first);\n                burst(point);\n")
  expect(entity).toContain("                strike(end, null);\n                burst(end);\n")
  expect(entity).toContain("if (impact.effect() != null) StudioEffects.spawn(impact.effect(), world, point, getYRot(), null, null);")
  expect(entity).toContain("SimpleParticleType type = StudioParticles.byAsset(impact.own());")
  expect(entity).toContain("if (impact.strength() > 0.0f) StudioShake.send(world, point, impact.strength(), impact.radius(), impact.ticks());")
  const lean = compileProjectiles({ ...input, impact: { effects: false, own: false, shake: false } }).files["src/main/java/com/minemods/content_spear_camp/entity/StudioProjectile.java"]!
  for (const name of ["StudioEffects.spawn(impact", "StudioParticles", "StudioShake", "SimpleParticleType"]) expect(lean).not.toContain(name)

  // What the reviewer reads and what the AI making it is told (with the 涿鹿 example).
  expect(abilityWords.hit(bursting.hits[0]!)).toContain("落下的那一刻（碰到人或者落地）在落点炸开：放出效果「b2b2b2b2-0000-4000-8000-0000000000bb」、冒出 12 个")
  expect(abilityWords.hit(bursting.hits[0]!)).toContain("32 格内的玩家屏幕晃动（力度 4，1.5 秒里停下）")
  expect(abilityWords.hit(rainAbility.hits[0]!)).toContain("冒出 6 个爆炸粒子（散开 0.5 格）")
  expect(abilityWords.hit(lanceAbility.hits[0]!)).not.toContain("炸开")
  expect(ABILITY_INSTRUCTIONS).toContain(PROJECTILE_INSTRUCTIONS)
  expect(PROJECTILE_INSTRUCTIONS).toContain("warn, impact}")
  expect(PROJECTILE_INSTRUCTIONS).toContain("impact（可选")
  const zhuolu = /例（涿鹿）：moves:(\[.*?\])，hits:(\[.*\])。/.exec(ARENA_ABILITY_INSTRUCTIONS)!
  const example = JSON.parse(zhuolu[2]!.replaceAll(/<[^>]+>/g, "b2b2b2b2-0000-4000-8000-000000000003"))
  expect(example[0].impact).toEqual({ effect: "b2b2b2b2-0000-4000-8000-000000000003", particle: "explosion", count: 24, spread: 3, shake: { strength: 4, radius: 32, seconds: 1.5 } })
  expect(AbilitySchema.safeParse({ ...rainAbility, length: 9, windup: 0.4, hits: example, moves: JSON.parse(zhuolu[1]!) }).error?.issues.filter((issue) => issue.path.includes("impact"))).toBeUndefined()
})

test("the pictures: the spear's arc lands at the target's feet, sticks 5 s and flies back to where it left; the volley falls on item 3's places", () => {
  const sketch = projectileSketch(lanceAbility, 0, spearGolemDesign)!
  const flight = sketch.flights[0]!
  expect(flight.land!.place.forward).toBeCloseTo(sketch.target, 6)
  expect(flight.land!.place.left).toBeCloseTo(0, 1)
  expect(flight.stuck).toBe(100)
  expect(flight.back.length).toBeGreaterThan(2)
  const home = flight.back.at(-1)!
  const left = flight.out[0]!
  home.forEach((value, axis) => expect(value).toBeCloseTo(left[axis]!, 6))
  const rain = projectileSketch(rainAbility, 0, fightingGolemDesign)!
  expect(rain.flights).toHaveLength(12)
  expect(rain.warn?.start).toBeCloseTo(0.1, 6)
  const places = skyPlaces({ type: "around_target", count: 12, spread: 6 }, 0, rain.target)
  rain.flights.forEach((one, index) => expect(one.land!.place.forward).toBeCloseTo(places[index]!.forward, 3))
  const loop = projectileSketch(whirlAbilities[0]!, 0, fightingGolemDesign)!
  expect(loop.flights[0]!.land).toBeNull()
  expect(abilityWords.hit(lanceAbility.hits[0]!)).toContain("插在地上 5 秒")
  expect(ABILITY_INSTRUCTIONS).toContain('type:"projectile"')
})

test("the reviewer: a straight throw that falls short, a spear away longer than the wait, a part never coming back, a volley of more than twelve, a sky volley without a warning", () => {
  const rule = (ability: Ability) => projectileIssues({ name: "矛将" }, ability, spearGolemDesign).map((issue) => issue.text)
  expect(rule(lanceAbility)).toEqual([expect.stringContaining("这期间它要是死了或者不见了")])
  const short = AbilitySchema.parse({ ...lanceAbility, hits: [{ ...lanceAbility.hits[0], path: "straight", speed: 0.4, gravity: 0.08 }] })
  expect(rule(short).join()).toContain("够不到")
  const hasty = AbilitySchema.parse({ ...lanceAbility, start: { ...lanceAbility.start, cooldown: 1 } })
  expect(rule(hasty).join()).toContain("游戏里这一下就不扔了")
  const lost = AbilitySchema.parse({ ...lanceAbility, hits: [{ ...lanceAbility.hits[0], comes_back: undefined }] })
  expect(rule(lost).join()).toContain("凭空重新出现")
  const flood = AbilitySchema.parse({ ...rainAbility, hits: [{ ...rainAbility.hits[0], from: { sky: { over: { type: "around_target", count: 16, spread: 8 }, height: 16 } } }] })
  expect(projectileIssues({ name: "雨师" }, flood, fightingGolemDesign).map((issue) => issue.text).join()).toContain("一次扔出 16 件东西")
  const silent = AbilitySchema.parse({ ...rainAbility, hits: [{ ...rainAbility.hits[0], warn: undefined }] })
  expect(projectileIssues({ name: "雨师" }, silent, fightingGolemDesign).map((issue) => issue.text).join()).toContain("却没有预警")
  // A part the model lacks stops the build, as every part a creature's document names.
  const missing = AbilitySchema.parse({ ...lanceAbility, hits: [{ ...lanceAbility.hits[0], look: { bone: "halberd" } }] })
  expect(boneIssues({ name: "矛将", abilities: [missing] }, spearGolemDesign).map((issue) => issue.stops)).toEqual([true])
  expect(abilityIssues({ name: "矛将", behavior: "hostile", abilities: [lanceAbility] }, spearGolemDesign.animations, spearGolemDesign).some((issue) => issue.rule === "ability_projectile")).toBe(true)
})

async function sample(target: TargetId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-projectile-"))
  roots.push(root)
  await createTargetProjectileSample(path.join(root, "矛将营"), target)
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(path.join(root, "矛将营"), source, TEMPLATE)
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
  return { source, built, names, read: (name: string) => readFile(path.join(source, name), "utf8") }
}

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: the thrown things are generated, wired to the loader, and the whole tree compiles`, async () => {
    const { built, names, read, source } = await sample(target)
    const pkg = "src/main/java/com/minemods/content_spear_camp"
    for (const name of ["entity/StudioProjectiles.java", "entity/StudioProjectile.java", "entity/StudioFlight.java", "client/StudioProjectileClient.java", "client/StudioProjectileRenderer.java", "entity/StudioWarn.java"]) expect(names).toContain(`${pkg}/${name}`)
    expect(built.projectileFiles).toContain("com/minemods/content_spear_camp/entity/StudioProjectiles.class")
    if (target === "fabric-1.21.1") {
      const metadata = JSON.parse(await read("src/main/resources/fabric.mod.json"))
      expect(metadata.entrypoints.main).toContain("com.minemods.content_spear_camp.entity.StudioProjectiles")
      expect(metadata.entrypoints.client).toContain("com.minemods.content_spear_camp.client.StudioProjectileClient")
    } else {
      expect(await read(`${pkg}/StudioContent.java`)).toContain("com.minemods.content_spear_camp.entity.StudioProjectiles.register();")
      expect(await read(`${pkg}/client/StudioClient.java`)).toContain("com.minemods.content_spear_camp.client.StudioProjectileClient.register();")
      expect(await read(`${pkg}/entity/StudioProjectiles.java`)).toContain('StudioPlatform.entity("studio_projectile",')
    }
    // The spear general throws its spear from where the spear is, hides it while it is out, and the volley is thrown when its warning begins.
    const lancer = await read(names.find((name) => /entity\/StudioCreatureEntity1_\w+\.java$/.test(name))!)
    expect(lancer).toContain("StudioProjectiles.launch(this, abilityTarget, new StudioProjectiles.Spec(1, 1.0, 0.05, 8.0f, 0.5, 1.5, new int[] {0, 40, 0}, 100, 0, 1, 0.0, false, 0, 0, 0.0, new double[] {}, 0.0, -1, -1, null, \"spear\"), 0, abilityShiftF, abilityShiftU, abilityShiftL, abilityYaw, 0, bossDamageScale());")
    expect(lancer).toContain("StudioProjectiles.Thrower")
    // Its last phase hides the spear (Boss 能力 10): one render sets its stage's bones and then the parts it has thrown, and a spear back in its hand stays hidden in that phase.
    const lancerRenderer = await read(names.find((name) => /client\/StudioCreatureRendererEntity1_\w+\.java$/.test(name))!)
    expect(lancerRenderer.match(/public void render\(/g)).toHaveLength(1)
    expect(lancerRenderer).toContain("String[] bones = creature.bossBones();")
    expect(lancerRenderer).toContain("if (!away && java.util.Arrays.asList(bones).contains(StudioCreatureEntity1_")
    // One that throws only effects' models and has no stages draws as it always did.
    const whirlRenderer = await read(names.find((name) => /client\/StudioCreatureRendererEntity3_\w+\.java$/.test(name))!)
    expect(whirlRenderer).not.toContain("public void render(")
    const rainer = await read(names.find((name) => /entity\/StudioCreatureEntity2_\w+\.java$/.test(name))!)
    expect(rainer).toMatch(/if \(tick == 2\) \{\n\s+StudioProjectiles\.launch\(this, abilityTarget, new StudioProjectiles\.Spec\(0, 0\.5, 0\.06, 5\.0f, 0\.3, 1\.5, new int\[\] \{\}, 40, -1, 1, 0\.0, true, 2, 12, 6\.0, new double\[\] \{\}, 16\.0, 0, 0, "b2b2b2b2-0000-4000-8000-000000000002", null, new StudioProjectiles\.Impact\(null, net\.minecraft\.core\.particles\.ParticleTypes\.EXPLOSION, null, 6, 0\.5, 0\.0f, 0\.0f, 0\)\), 0, 0\.0, 0\.0, 0\.0, abilityYaw, 18, 1\.0f\);/)
    expect(rainer).not.toContain("Thrower")
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src/main/java"))
    expect(compiled.output).not.toContain("error")
    expect(compiled.code).toBe(0)
  }, 180000)
}

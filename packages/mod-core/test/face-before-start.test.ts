import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { putModelAsset } from "../src/assets"
import { assembleBuildSource } from "../src/build-source"
import { GROUND_TURN, faceTolerance } from "../src/creature-abilities"
import { flightPlan } from "../src/creature-flight"
import { lanceAbility } from "../script/target-projectile-sample"
import { readGeneratedCreature, creatureContractLines } from "../src/creature-contract"
import { AbilitySchema, EntitySchema, type Ability } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { saveProject } from "../src/project"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { dragonBoss, dragonDesign, dragonFlight, dragonHabits, dragonHitbox, epicAbilities } from "./giant-flier"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

/**
 * epic game5: a frost dragon's tail sweep (`lock`, windup 0.8 s, a sphere of radius 3 anchored on a bone whose centre lies 8.55 ahead at the hit) was used 18 times and hit 0. It started a `lock` ability with
 * the body as it stood and never turned during the windup, and two sweeps began right after it stepped back (`getMoveControl().moveTo` turns the body to where it walks, away from the target) with the body
 * pointing -180° from the player. Now it steps back with `strafeTo` facing the target, and an ability whose hits lie ahead of it starts only when the body already points close enough to the target.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const base = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "dragon", name: "巨龙", health: 400, speed: 0.25, attack_damage: 3, behavior: "hostile" as const }
const entityFile = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const gen = (input: Record<string, unknown>) => String(compileEntity({ ...base, model: fightingGolemDesign, ...input } as never)[entityFile])
const near = (value: number, expected: number, digits = 2) => expect(Math.abs(value - expected)).toBeLessThan(10 ** -digits)

const sphere = (radius: number, forward: number, extra: Record<string, unknown> = {}) => ({ type: "area", at: 0.9, shape: { type: "sphere", forward, up: 0, left: 0, radius }, hits: "target", damage: 8, knockback: 1, effects: [], ...extra })
const ability = (extra: Record<string, unknown>): Ability => AbilitySchema.parse({ ...golemAbilities[0], id: "sweep", name: "sweep", clip: "slam", windup: 0.8, length: 1.2, facing: "lock", start: { min_distance: 3, max_distance: 9, line_of_sight: true, cooldown: 3, weight: 1 }, ...extra })
const shapeOf = (shape: Record<string, unknown>) => ({ type: "area", at: 0.9, shape, hits: "target", damage: 8, knockback: 1, effects: [] })

// ---- the tolerance ----

test("a lock ability's tolerance is how far off the body may point and the hit still meets the target, the smallest over its hits", () => {
  // The dragon's sweep: a sphere of radius 3 whose centre is 8.55 ahead at the hit (the bone's 6.55 and the shape's 2).
  const sweep = ability({ hits: [sphere(3, 2, { bone: "tail_strike" })] })
  near(faceTolerance(sweep, [{ forward: 6.55, up: 1, left: 0.2 }]), (Math.atan(3 / 8.55) * 180) / Math.PI)
  expect(faceTolerance(sweep, [{ forward: 6.55, up: 1, left: 0.2 }])).toBeLessThan(19.4)
  expect(faceTolerance(sweep, [{ forward: 6.55, up: 1, left: 0.2 }])).toBeGreaterThan(19.3)
  // From the feet (no bone): the centre is the shape's own forward.
  near(faceTolerance(ability({ hits: [sphere(1, 4)] }), [null]), (Math.atan(1 / 4) * 180) / Math.PI)
  // A box: half its width over the forward of its centre.
  near(faceTolerance(ability({ hits: [shapeOf({ type: "box", forward: 5, up: 0, left: 0, width: 4, height: 2, depth: 3 })] }), [null]), (Math.atan(2 / 5) * 180) / Math.PI)
  // An arc and a cone kept level cover their own half angle; a level beam, its radius over the middle of its length.
  near(faceTolerance(ability({ hits: [shapeOf({ type: "arc", reach: 4, angle: 90, low: -1, high: 2 })] }), [null]), 45)
  near(faceTolerance(ability({ hits: [shapeOf({ type: "cone", up: 1, length: 6, angle: 50, aim: "level" })] }), [null]), 25)
  near(faceTolerance(ability({ hits: [shapeOf({ type: "line", up: 1, length: 10, radius: 1, aim: "level" })] }), [null]), (Math.atan(1 / 5) * 180) / Math.PI)
  // Several hits: the narrowest holds, so every one of them can land.
  near(faceTolerance(ability({ hits: [shapeOf({ type: "arc", reach: 4, angle: 90, low: -1, high: 2 }), sphere(1, 4)] }), [null, null]), (Math.atan(1 / 4) * 180) / Math.PI)
  // A hit aimed at the target (a beam or a cone not kept level), a shot, an arc all round, a dive and an air ability need no facing here.
  expect(faceTolerance(ability({ hits: [shapeOf({ type: "line", up: 1, length: 10, radius: 1 })] }), [null])).toBe(180)
  expect(faceTolerance(ability({ hits: [shapeOf({ type: "cone", up: 1, length: 6, angle: 50, aim: "target" })] }), [null])).toBe(180)
  expect(faceTolerance(ability({ hits: [shapeOf({ type: "arc", reach: 4, angle: 360, low: -1, high: 2 })] }), [null])).toBe(180)
  expect(faceTolerance(ability({ hits: [{ type: "shot", at: 0.9, projectile: "snowball", speed: 1, forward: 1, up: 1, damage: null }] }), [null])).toBe(180)
  expect(faceTolerance(ability({ hits: [sphere(3, 2)], dive: true, where: "air" }), [null])).toBe(180)
  expect(faceTolerance(ability({ hits: [sphere(3, 2)], where: "air" }), [null])).toBe(180)
})

test("yaw-independent strikes start at any bearing on ground and in flight, including short windups", () => {
  const ball = sphere(2, 0)
  const circle = { type: "arc", reach: 6, low: -1, high: 3, angle: 360 }
  const arena = shapeOf({ type: "arena", low: -2, high: 12 })
  const callback = { type: "gameplay", at: 0.9, gameplay: "summons", action: "spawn" }
  const track = (extra: Record<string, unknown>) => ability({ windup: 0.1, facing: "track", ...extra })
  const beam = { type: "beam", at: 0.5, until: 1, forward: 0, up: 1, left: 0, aim: "ahead", turn: 0, length: 6, width: 0.3, color: "#99ccff", damage: 2, hits: "everyone", effects: [], every_ticks: 10 }
  const hazard = { type: "hazard", at: 0.5, where: "self", hit: null, forward: 0, left: 0, radius: 2, seconds: 1, color: "#99ccff", glow: false, damage: 2, hits: "everyone", effects: [], every_ticks: 10 }
  const omni = [
    track({ hits: [ball] }), track({ hits: [shapeOf(circle)] }), track({ hits: [shapeOf({ ...circle, inner: 2 })] }),
    track({ hits: [arena] }), track({ hits: [callback] }), track({ hits: [ball, arena, callback], events: [hazard] }),
    track({ hits: [ball], events: [{ type: "lightning", at: 0.9, place: "self", radius: 2, damage: 2 }] }),
  ]
  for (const move of omni) {
    expect(faceTolerance(move, [])).toBe(180)
    expect(faceTolerance(move, [], 30)).toBe(180)
    expect(faceTolerance({ ...move, facing: "lock" }, [])).toBe(180)
  }
  const shot = { type: "shot", at: 0.9, projectile: "snowball", speed: 1, forward: 1, up: 1, damage: null }
  const mixed = [
    track({ hits: [ball, shot] }), track({ hits: [lanceAbility.hits[0], ball] }),
    track({ hits: [ball, shapeOf({ type: "line", up: 1, length: 10, radius: 1 })] }),
    track({ hits: [ball, { ...ball, place: { type: "pattern", points: [{ forward: 0, left: 2 }] } }] }),
    track({ hits: [ball], events: [{ type: "lightning", at: 0.9, place: { type: "pattern", points: [{ forward: 2, left: 0 }] }, radius: 2, damage: 2 }] }),
    track({ hits: [ball], events: [beam] }), track({ hits: [ball], events: [{ ...hazard, left: 1 }] }),
    track({ hits: [shapeOf({ ...ball.shape, left: 1 })] }), track({ hits: [sphere(2, 0, { bone: "head" })] }),
    track({ hits: [ball], moves: [{ type: "dash", from: 0.5, to: 1, speed: 10, distance: 5, aim: "locked_at_windup", stop_at_wall: true, hit: 0 }] }),
  ]
  for (const move of mixed) {
    expect(faceTolerance({ ...move, facing: "lock" }, [])).toBe(90)
    expect(faceTolerance(move, [], 30)).toBe(93)
  }
  expect(flightPlan(dragonFlight, omni, true).faces).toEqual(omni.map(() => false))
  expect(flightPlan(dragonFlight, mixed, true).faces).toEqual(mixed.map(() => true))
})

test("a track ability is held to what it turns while getting ready: 30 degrees a tick over the ticks and one more, none from 5 ticks of windup", () => {
  const tracked = (windup: number) => ability({ facing: "track", windup, length: 1.2, hits: [sphere(1, 4)] })
  expect(GROUND_TURN).toBe(30)
  // 0.1 s = 2 ticks: 3 * 30; 0.2 s = 4 ticks: 150; 0.25 s = 5 ticks: 180 (any); the dragon's own 0.8 s: any.
  expect(faceTolerance(tracked(0.1), [null])).toBe(90)
  expect(faceTolerance(tracked(0.2), [null])).toBe(150)
  expect(faceTolerance(tracked(0.25), [null])).toBe(180)
  expect(faceTolerance(tracked(0.8), [null])).toBe(180)
  // Without a hit laid out ahead of it, a short wind-up holds nothing.
  expect(faceTolerance(ability({ facing: "track", windup: 0.1, hits: [shapeOf({ type: "line", up: 1, length: 10, radius: 1 })] }), [null])).toBe(180)
})

// ---- the generated Java ----

const sweepAbilities = [ability({ hits: [sphere(3, 2)] }), ...golemAbilities.map((one) => AbilitySchema.parse(one))]

test("a creature with an ability whose hits lie ahead starts it only facing the target, and turns to the target while it waits", () => {
  const out = gen({ abilities: sweepAbilities })
  // Per ability: the sweep (a sphere 3 radius, 2 ahead, from the feet), the slam (track, a 10 tick windup) and the burst (aimed beams) are held to 56.31, any, any.
  expect(out).toContain("private static final double[] ABILITY_FACES = {56.3, 180.0, 180.0};")
  expect(out).toContain("|| !abilityFaces(index, target)) return false;")
  expect(out).toContain("private boolean abilityFaces(int index, LivingEntity target) {")
  expect(out).toContain("- 90.0f - yBodyRot));\n        return off <= ABILITY_FACES[index];")
  expect(out).toContain("if (total == 0) {\n            // Nothing may start, perhaps only because its body does not yet face them: it turns to them while it waits.\n            abilityFace(target);\n            return false;\n        }")
  expect(out).toContain("getLookControl().setLookAt(target, 30.0f, 30.0f);\n        lookAt(target, 30.0f, 30.0f);\n        setYBodyRot(getYRot());")
  expect(out).toContain("if (abilityFacedAt == tickCount) return;")
  expect(readGeneratedCreature(out, null).ability_faces).toBe(true)
})

test("it steps back facing the target: strafed backwards, never moved to a point away from them", () => {
  const out = gen({ abilities: sweepAbilities })
  expect(out).toContain("abilityFace(target);\n            // Backwards, not along a path")
  expect(out).toContain("getNavigation().stop();\n            getMoveControl().strafe(-1.0f, 0.0f);\n            return true;")
  expect(out).not.toContain("getMoveControl().setWantedPosition(")
  expect(readGeneratedCreature(out, null).ability_backs).toBe(true)
  // Without a ready ability it can step back for there is no step back, and without a hit ahead of it no facing is held.
  const burst = golemAbilities.map((one) => AbilitySchema.parse(one))
  const aimed = gen({ abilities: burst })
  expect(aimed).toContain("strafe(-1.0f, 0.0f)")
  expect(aimed).toContain("private void abilityFace(LivingEntity target) {")
  expect(aimed).not.toContain("ABILITY_FACES")
  expect(aimed).not.toContain("abilityFaces(")
  expect(aimed).not.toContain("if (total == 0) {")
})

test("a creature whose abilities have no hit laid out ahead of it, and no window to step back for, is written exactly as it was", () => {
  // A track slam, an aimed beam and a cone aimed at the target: nothing is held, nothing to step back for (windows start at 0 and 1).
  const kept = [
    AbilitySchema.parse({ ...golemAbilities[0], start: { ...golemAbilities[0].start, min_distance: 0 } }),
    AbilitySchema.parse({ ...golemAbilities[1], start: { ...golemAbilities[1].start, min_distance: 1 } }),
  ]
  const out = gen({ abilities: kept })
  for (const word of ["ABILITY_FACES", "abilityFace", "abilityFacedAt", "strafe(", " lookAt(", "abilityBackOff"]) expect(out).not.toContain(word)
  expect(out).toContain("if (total == 0) return false;")
  // The same creature said another way is the same file.
  expect(gen({ abilities: kept.map((one) => ({ ...one })) })).toBe(out)
  // No abilities: no word of any of it.
  expect(gen({}).toLowerCase()).not.toContain("ability")
})

test("a flier holds the new rule to the ground, where it turns as one that walks; in the air flightFaces holds it", () => {
  const flier = gen({ abilities: epicAbilities.map((one) => (one.id === "sweep" ? ability({ ...one, id: "sweep", facing: "lock", where: "ground", windup: 0.8, hits: [sphere(3, 2)], start: { min_distance: 0, max_distance: 12, line_of_sight: true, cooldown: 3, weight: 1 } }) : one)), flight: dragonFlight, habits: dragonHabits, boss: dragonBoss, model: dragonDesign })
  expect(flier).toMatch(/private static final double\[\] ABILITY_FACES = \{180\.0, 180\.0, 56\.3\};/)
  expect(flier).toContain("if (ABILITY_FACES[index] >= 180.0 || flightState() != FLIGHT_GROUND) return true;")
  expect(flier).toContain("|| !flightFaces(index, target) || !abilityFaces(index, target)) return false;")
  expect(flier).toContain("private void abilityFace(LivingEntity target) {\n        if (flightState() != FLIGHT_GROUND) return;")
  // The air abilities (a dive and a breath) carry no tolerance of their own.
  const sweepless = gen({ abilities: epicAbilities, flight: dragonFlight, habits: dragonHabits, boss: dragonBoss, model: dragonDesign })
  expect(sweepless).not.toContain("ABILITY_FACES")
})

test("the contract says the creature faces its target before an ability whose hits lie ahead, in one sentence", () => {
  const withFacing = readGeneratedCreature(gen({ abilities: sweepAbilities }), null)
  const lines = creatureContractLines({ title: "龙", key: "dragon" }, withFacing).join("\n")
  expect(lines).toContain("判定摆在它身前、不朝目标瞄的招式（扇形、方块、球、水平光束），要它的身体已经朝着目标、偏差不超过判定罩得住的角度才会开始；还没朝着的时候它先转向目标。")
  const without = creatureContractLines({ title: "傀儡", key: "golem" }, readGeneratedCreature(gen({ abilities: golemAbilities.map((one) => AbilitySchema.parse(one)) }), null)).join("\n")
  expect(without).not.toContain("偏差不超过判定罩得住的角度")
})

// ---- compiled ----

test.skipIf(!hasTargetJavac(OFFICIAL))("the generated tree of a flying boss with a locked ground sweep from a bone, and of a walking golem with one, compiles", async () => {
  for (const flying of [true, false]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-face-"))
    roots.push(root)
    const directory = path.join(root, "project")
    const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
    const sweep = ability({ id: "sweep", name: "sweep", clip: flying ? "sweep" : "slam", where: flying ? "ground" : undefined, windup: 0.8, hits: [sphere(3, 2, { bone: flying ? "tail_3" : undefined })] })
    const entity = flying
      ? EntitySchema.parse({ ...sample.entities[0]!, abilities: [epicAbilities[0]!, epicAbilities[1]!, sweep], flight: dragonFlight, habits: dragonHabits, boss: dragonBoss, hitbox: dragonHitbox })
      : EntitySchema.parse({ ...sample.entities[0]!, abilities: [...golemAbilities.map((one) => AbilitySchema.parse(one)), sweep] })
    const blueprint = {
      request: "做一只会转身的怪",
      style: { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" },
      questions: [],
      revision: 1,
      state: "confirmed" as const,
      entries: [
        { key: "model", kind: "model", title: "模型", brief: "说明", owner: "dragon", needs: [], out_of_scope: null, asset_id: entity.id },
        { key: "dragon", kind: "entity", title: "怪", brief: "一只怪", owner: null, needs: ["model"], out_of_scope: null, asset_id: null, tier: { level: flying ? ("epic" as const) : ("standard" as const), reason: "测试", by: "ai" as const } },
      ],
    }
    const saved = await saveProject(directory, { ...sample, entities: [entity], blueprint } as never, sample.revision)
    if (flying) await putModelAsset(directory, { entity_id: entity.id, data: { design: dragonDesign }, origin: "example", expectedRevision: saved.revision })
    const source = path.join(root, "source")
    await mkdir(source)
    const built = await assembleBuildSource(directory, source, TEMPLATE)
    expect(built.findings.filter((finding) => finding.stops)).toEqual([])
    const compiled = (await compileTreeFor(OFFICIAL, source))!
    expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
    expect(compiled.code).toBe(0)
  }
}, 360000)

test("a ready steady cast keeps aligning inside the idle turn threshold", () => {
  const abilities = [ability({ facing: "track", turn_speed: 30, track_until: 0.8, hits: [sphere(0.5, 13)] })]
  const steady = { preset: "colossal", body_turn: 20, turn_after: 90 }
  const out = gen({ abilities, steady })
  expect(out).toContain("ABILITY_FACES = {26.2};")
  expect(out).toContain("if (!ready) return false;\n        if (abilityFaces(index, target)) return true;\n        abilityAlignUntil = tickCount + 1;")
  expect(out).toContain("if (settle > 0.0f && gap <= settle) steadyTurning = false;")
  expect(out).toContain("boolean alignForCast = abilityAlignUntil >= tickCount;\n            abilityAlignUntil = -1;")
  expect(out).toContain("if (steadyTurning || alignForCast)")
  expect(gen({ abilities, steady: { ...steady, body_turn: 0 } })).not.toContain("abilityAlignUntil")
  expect(gen({ abilities, steady: { ...steady, turn_after: 20 } })).not.toContain("abilityAlignUntil")
})

test("a late near-range request still checks distance before asking the next look update to align", () => {
  const cast = ability({
    facing: "track", turn_speed: 30, track_until: 0.3,
    start: { min_distance: 0, max_distance: 0.5, line_of_sight: false, cooldown: 9, weight: 6 },
    hits: [shapeOf({ type: "arc", reach: 14, angle: 15.98, low: -0.5, high: 3 })],
  })
  const out = gen({ abilities: [cast], steady: { preset: "colossal", body_turn: 20, turn_after: 90 } })
  expect(out).toContain("ABILITY_FACES = {16.99};")
  expect(out).toMatch(/case 0 -> distance >= 0\.0 && distance <= 0\.5;[^}]+};\s*if \(!ready\) return false;/)
  expect(out).toContain("if (abilityFaces(index, target)) return true;\n        abilityAlignUntil = tickCount + 1;")
})

// r27 filming: a combo is a choice after the abilities. Its start is held to its first step's tolerance, and the same alignment keeps the body turning to it; a narrow later step is not waited for.
test("a steady combo whose first step is narrow aligns like that ability; a narrow later step starts without waiting", () => {
  const narrow = ability({ id: "watch", name: "watch", facing: "track", turn_speed: 30, track_until: 0.8, hits: [sphere(0.5, 13)] })
  const wide = ability({ id: "ring", name: "ring", facing: "track", hits: [shapeOf({ type: "arc", reach: 4, angle: 360, low: -1, high: 2 })] })
  const start = { min_distance: 0, max_distance: 32, line_of_sight: false, cooldown: 5, weight: 3 }
  const combos = [
    { id: "narrow_first", name: "窄角起手", steps: ["watch", "ring"], gap_ticks: 2, damage_scale: 1, start },
    { id: "narrow_later", name: "中途窄角", steps: ["ring", "watch"], gap_ticks: 2, damage_scale: 1, start },
  ]
  const steady = { preset: "colossal", body_turn: 20, turn_after: 90 }
  const out = gen({ abilities: [narrow, wide], combos, steady })
  expect(out).toContain("ABILITY_FACES = {26.2, 180.0};")
  expect(out).toContain("if (ABILITY_FACES[abilityFirst(index)] >= 180.0) return true;")
  expect(out).toContain("private int abilityFirst(int index) { return index < 2 ? index : COMBO_STEPS[index - 2][0]; }")
  expect(out).toContain("            case 2 -> distance >= 0.0 && distance <= 32.0;\n            case 3 -> distance >= 0.0 && distance <= 32.0;")
  expect(out).toContain("if (!ready) return false;\n        if (abilityFaces(index, target)) return true;\n        abilityAlignUntil = tickCount + 1;")
  expect(out).toContain("if (steadyTurning || alignForCast)")
  const next = out.slice(out.indexOf("private void comboNext()"), out.indexOf("private float abilityDamageScale()"))
  expect(next).toContain("abilityIndex = COMBO_STEPS[comboIndex][comboStep];")
  expect(next).not.toContain("abilityFaces")
})

test("a steady stance transition blocks both walking and turning for a ready narrow cast", () => {
  const out = gen({
    abilities: [ability({ facing: "track", turn_speed: 30, track_until: 0.8, hits: [sphere(0.5, 13)] })],
    steady: { preset: "colossal", body_turn: 20, turn_after: 90 },
    stances: { start: "wait", list: [
      { id: "wait", name: "站定", clips: { walk: null }, max_seconds: 1, then: "ready" },
      { id: "ready", name: "备战", change: { clip: "slam", seconds: 0.5 } },
    ] },
  })
  expect(out).toMatch(/boolean alignForCast = abilityAlignUntil >= tickCount;\s+abilityAlignUntil = -1;\s+if \([^\n]+!\(abilityRunning\(\) \|\| stanceChanging\(\)[^\n]+\{[\s\S]*?if \(steadyTurning \|\| alignForCast\)/)
  expect(out).toContain("return !stanceChanging() && stanceIndex() != 0;")
  expect(out).toContain("if (!stanceCanWalk()) {\n                operation = Operation.WAIT;")
  expect(out).toContain("return !stanceChanging() && stanceAllows(index) && stanceRequires(index);")
  expect(out).toMatch(/private boolean abilityMayStart\([^\n]+\n[^\n]+!combatAllows\(index\)[\s\S]*?abilityAlignUntil = tickCount \+ 1;/)
  expect(out).toContain("if (!level().isClientSide()) stanceHoldFacing();")
})

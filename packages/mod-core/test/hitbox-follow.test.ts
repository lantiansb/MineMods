import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { MotionClip } from "@minemods/studio-ai/model-motion"
import { putModelAsset } from "../src/assets"
import { assembleBuildSource } from "../src/build-source"
import { EntitySchema, HITBOX_LIMITS, HitboxSchema } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { compileHitboxParts, hitboxSource } from "../src/fabric/hitbox"
import { followedAt, followedPlace, followMoments, hitboxFollow, HITBOX_FOLLOW } from "../src/hitbox-follow"
import { followKeyFrames, hitboxBoxesAt, hitboxFault, hitboxFit, hitboxLines } from "../src/creature-hitbox"
import { modelBounds } from "../src/model-bounds"
import { modelReach, sightOf } from "../src/model-reach"
import { saveProject } from "../src/project"
import { createDataGameplaySample } from "../script/data-gameplay-sample"
import { genTarget } from "../src/platform/target"
import { dragonAnchoredAbilities, dragonBoss, dragonDesign, dragonFlight, dragonHabits, dragonHitbox } from "./giant-flier"
import { giantAbilities, giantDesign, giantHitbox } from "./giant-walker"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac, targetJdkTool } from "./target-javac"

/**
 * 任务二 第 1 项「超大体型」: up to 16 further boxes, the ones that name a bone follow it (a table measured at build time and looked up by the server), a step height and
 * what a big body does when it gets stuck. A part that names no bone is what it always was, to the byte.
 */

const OFFICIAL = hasTargetJavac("fabric-1.21.1-official")
const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const base = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "dragon", name: "巨龙", health: 400, speed: 0.25, attack_damage: 3, behavior: "hostile" as const }
const entityFile = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const partFile = "src/main/java/com/minemods/content_golem_mod/entity/StudioPart.java"
const java = (files: Record<string, string | Uint8Array>) => String(files[entityFile])
const sha = (files: Record<string, string | Uint8Array>) => {
  const text = Object.keys(files).sort().map((name) => `${name}\n${files[name]}`).join("\n")
  return `${createHash("sha256").update(text).digest("hex").slice(0, 16)} ${text.length}`
}
const bare = HitboxSchema.parse({ ...dragonHitbox, parts: dragonHitbox.parts!.map(({ bone: _bone, ...part }) => part) })
const giant = { ...base, id: "giant", name: "六臂巨人", model: giantDesign, abilities: giantAbilities, hitbox: giantHitbox }

test("the sample giant is what the task names: 9 blocks tall, about 6 wide, six arms, more than 150 cubes", () => {
  const bounds = modelBounds(giantDesign)
  expect(bounds.height).toBeCloseTo(9, 1)
  expect(giantDesign.bones.filter((bone) => bone.name.startsWith("hand_")).length).toBe(6)
  expect(giantDesign.bones.reduce((sum, bone) => sum + bone.cubes.length, 0)).toBeGreaterThan(150)
})

test("the giant is culled by the room it fills: its arms reach out of a core of 4, so the game is told a box that holds them, and it is 9 tall", () => {
  const visible = sightOf(giantDesign, giantHitbox.core, false, 0)
  const built = modelReach(giantDesign, giantHitbox.core.height / 2).built
  expect(built.high).toBeCloseTo(9, 1)
  expect(visible.sight).not.toBeNull()
  expect(visible.sight!.reach).toBeGreaterThanOrEqual(built.flat)
  expect(visible.sight!.high).toBeGreaterThanOrEqual(built.high)
  expect(java(compileEntity(giant as never))).toContain("@Override public net.minecraft.world.phys.AABB getBoundingBoxForCulling()")
})

test("the review: a bone the model lacks, a part mostly inside the core, how many parts; and the moments the picture shows the followers at", () => {
  const fit = hitboxFit(giantHitbox, giantDesign)
  expect(fit.parts).toEqual({ count: 7, most: 16, following: giantHitbox.parts!.map((part) => part.name) })
  expect(fit.missing).toEqual([])
  expect(fit.overlapping).toEqual([])
  expect(fit.faults.map((found) => found.fault)).not.toContain("bone")
  expect(hitboxLines(fit)[0]).toContain("跟着模型的 hand_left_0 动")
  // A typo in a bone, and a part put inside the body (its height counted from the core's top would be 9 + 5; this one is at 5, inside).
  const wrong = HitboxSchema.parse({ ...giantHitbox, parts: [{ ...giantHitbox.parts![0]!, bone: "hand_left0" }, { name: "胸", forward: 0, up: 5, left: 0, width: 1, height: 1 }] })
  const told = hitboxFit(wrong, giantDesign)
  expect(told.missing).toEqual([{ name: "左手1", bone: "hand_left0" }])
  expect(told.overlapping).toEqual([{ name: "胸", share: 1 }])
  const lines = hitboxLines(told).filter(hitboxFault)
  expect(lines.some((line) => line.includes("hand_left0") && line.includes("模型里没有这根骨骼"))).toBe(true)
  expect(lines.some((line) => line.includes("「胸」的箱子有 100% 在身体（core）的箱子里面"))).toBe(true)
  // An overlap may be said to be meant; a wrong bone may not.
  const meant = hitboxFit(HitboxSchema.parse({ ...wrong, justified: [{ what: "overlap", reason: "胸甲要单独算" }, { what: "bone", reason: "随便" }] }), giantDesign)
  expect(meant.faults.find((found) => found.fault === "overlap")?.reason).toBe("胸甲要单独算")
  expect(meant.faults.find((found) => found.fault === "bone")?.reason).toBeNull()
  // Three moments each of standing, walking and its one ability; within each motion's length.
  const frames = followKeyFrames(giantHitbox, giantDesign, giantAbilities)
  expect(frames.map((frame) => frame.clip)).toEqual(["idle", "walk", "slam"])
  frames.forEach((frame) => {
    expect(frame.times).toHaveLength(3)
    const length = giantDesign.animations.find((clip) => clip.name === frame.clip)!.length
    frame.times.forEach((time) => expect(time).toBeLessThanOrEqual(length))
  })
  // The slam's middle moment is where its hands are furthest: the boxes at that moment are not where they stand as built.
  const slam = giantDesign.animations.find((clip) => clip.name === "slam") as MotionClip
  expect(hitboxBoxesAt(giantHitbox, giantDesign, slam, frames[2]!.times[1]!)[1]!.min).not.toEqual(hitboxBoxesAt(giantHitbox, giantDesign, null, 0)[1]!.min)
  expect(followKeyFrames(bare, dragonDesign)).toEqual([])
})

test("a hitbox has up to 16 parts, a core of 6 by 9 and more, a step of 0.5 to 3, and what it does when stuck", () => {
  expect(HITBOX_LIMITS.parts).toBe(16)
  const part = (index: number) => ({ name: `p${index}`, forward: 0, up: 0, left: 0, width: 1, height: 1 })
  expect(HitboxSchema.safeParse({ core: { width: 6, height: 9 }, parts: Array.from({ length: 16 }, (_, index) => part(index)) }).success).toBe(true)
  expect(HitboxSchema.safeParse({ core: { width: 6, height: 9 }, parts: Array.from({ length: 17 }, (_, index) => part(index)) }).success).toBe(false)
  expect(HitboxSchema.safeParse({ core: { width: 16, height: 16 } }).success).toBe(true)
  expect(HitboxSchema.safeParse({ core: { width: 4, height: 9, step: 0.4 } }).success).toBe(false)
  expect(HitboxSchema.safeParse({ core: { width: 4, height: 9, step: 3.1 } }).success).toBe(false)
  expect(HitboxSchema.parse({ core: { width: 4, height: 9 }, stuck: {} }).stuck).toEqual({ seconds: 3, squeeze: false })
  expect(HitboxSchema.safeParse({ core: { width: 4, height: 9 }, stuck: { seconds: 11 } }).success).toBe(false)
})

test("the table: every hand and the head follow; read the way the server reads it, it is where the bone has gone, to 1/128 of a block", () => {
  const table = hitboxFollow(giantHitbox, giantDesign, giantAbilities)!
  expect(table.followers).toBe(7)
  expect(table.columns).toEqual([0, 1, 2, 3, 4, 5, 6])
  expect(table.motions.map((motion) => [motion.name, motion.ticks, motion.loop])).toEqual([["idle", 60, true], ["walk", 32, true], ["slam", 24, false]])
  expect(table.abilities).toEqual([2])
  table.motions.forEach((motion, row) => {
    const clip = giantDesign.animations.find((animation) => animation.name === motion.name) as MotionClip
    // One row every two ticks and the end, each 7 followers of three values of three letters.
    expect(motion.moves.length).toBe(followMoments(clip).length * 7 * 3 * HITBOX_FOLLOW.letters)
    followMoments(clip).forEach((time, at) =>
      giantHitbox.parts!.forEach((_, index) => {
        const found = followedAt(table, index, row, at * HITBOX_FOLLOW.every)!
        const exact = followedPlace(giantHitbox, giantDesign, index, clip, time)
        ;(["forward", "up", "left"] as const).forEach((axis) => expect(Math.abs(found[axis] - exact[axis])).toBeLessThanOrEqual(0.5 / HITBOX_FOLLOW.unit + 1e-4))
      }),
    )
  })
  // The slam lifts the hands: the top pair's hands go up by more than half a block at its middle.
  const slam = giantDesign.animations.find((animation) => animation.name === "slam") as MotionClip
  expect(followedPlace(giantHitbox, giantDesign, 0, slam, 0.6).up).toBeGreaterThan(0.5)
  // Standing and walking go round; an ability holds its end.
  expect(followedAt(table, 0, 0, 60)).toEqual(followedAt(table, 0, 0, 0))
  expect(followedAt(table, 0, 2, 500)).toEqual(followedAt(table, 0, 2, 24))
  // Halfway between two rows is halfway between their values.
  const [low, high, middle] = [followedAt(table, 0, 1, 4)!, followedAt(table, 0, 1, 6)!, followedAt(table, 0, 1, 5)!]
  expect(middle.up).toBeCloseTo((low.up + high.up) / 2, 6)
})

test("no table without a part that follows a bone that moves: a bone the model lacks, a bone that never moves, or no bone at all", () => {
  expect(hitboxFollow(bare, dragonDesign, [])).toBeNull()
  expect(hitboxFollow(HitboxSchema.parse({ ...giantHitbox, parts: [{ ...giantHitbox.parts![0]!, bone: "no_such_bone" }] }), giantDesign, giantAbilities)).toBeNull()
  // The shins move with the thighs in the walk, but no thigh is in the idle: a part on a bone that only the walk moves follows; one on a leg of a still model would not.
  const still = { ...giantDesign, animations: giantDesign.animations.map((clip) => ({ ...clip, channels: [] })) }
  expect(hitboxFollow(giantHitbox, still as never, giantAbilities)).toBeNull()
  // A part that names a missing bone keeps no column, its neighbours do.
  const mixed = HitboxSchema.parse({ ...giantHitbox, parts: [{ ...giantHitbox.parts![0]!, bone: "no_such_bone" }, giantHitbox.parts![1]!] })
  expect(hitboxFollow(mixed, giantDesign, giantAbilities)!.columns).toEqual([-1, 0])
})

test("a part that names no bone is what it always was, to the byte: the hashes are of the files written at 874bdf7 (before parts could follow)", () => {
  const claw = dragonAnchoredAbilities[3]!
  expect(sha(compileEntity({ ...base, model: dragonDesign, hitbox: bare, abilities: [dragonAnchoredAbilities[0]!, dragonAnchoredAbilities[2]!, claw], flight: dragonFlight } as never))).toBe("c7baf5cbc4cc3683 235699")
  expect(sha(compileEntity({ ...base, model: dragonDesign, hitbox: bare, abilities: dragonAnchoredAbilities, flight: dragonFlight, habits: dragonHabits, boss: dragonBoss } as never))).toBe("62a2a403d30d91da 290197")
  expect(sha(compileEntity({ ...base, model: dragonDesign, hitbox: bare, abilities: dragonAnchoredAbilities } as never))).toBe("040bedb96b0332ea 190309")
  // The part class of a mod with no part that follows, with and without the lean.
  const pin = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod" }
  expect(sha(compileHitboxParts({ ...pin, follow: false }).files)).toBe("513a00c335dc37c4 10167")
  expect(compileHitboxParts({ ...pin, lean: true, follow: false }).files[partFile]).toBe(compileHitboxParts({ ...pin, lean: true }).files[partFile])
})

test("the generated class: the table, the step, the stuck goal; nothing of the three without them", () => {
  const text = java(compileEntity(giant as never))
  expect(text).toContain("private static final int[] HITBOX_COLUMNS = {0, 1, 2, 3, 4, 5, 6};")
  expect(text).toContain("private static final int[] HITBOX_MOTION_TICKS = {60, 32, 24};")
  expect(text).toContain("private static final int[] HITBOX_ABILITY_MOTION = {2};")
  expect(text).toContain("@Override public float[] hitboxMoved(int index) {")
  expect(text).toContain("        hitboxPose();\n")
  expect(text).toContain(".add(Attributes.STEP_HEIGHT, 1.5)")
  expect(text).toContain("private static final int STUCK_TICKS = 60;")
  expect(text).toContain("private static final boolean STUCK_SQUEEZE = true;")
  expect(text).toContain("goalSelector.addGoal(0, new StuckGoal());")
  // Who it is after: its target (a hostile creature without a runtime block has the game's target goal).
  expect(text).toContain("after = getTarget();")
  // One that stays where it is has nowhere to go.
  expect(java(compileEntity({ ...giant, stationary: { reason: "守门" } } as never))).not.toContain("StuckGoal")
  const plain = java(compileEntity({ ...giant, hitbox: HitboxSchema.parse({ core: { width: 4, height: 9 }, parts: bare.parts }) } as never))
  for (const absent of ["STEP_HEIGHT", "StuckGoal", "HITBOX_MOVES", "hitboxMoved", "hitboxPose"]) expect(plain).not.toContain(absent)
  // The part class of a mod with a follower asks its creature and tells every player's game.
  const part = String(compileHitboxParts({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", follow: true }).files[partFile])
  expect(part).toContain("default float[] hitboxMoved(int index) { return null; }")
  expect(part).toContain("EntityDataSerializers.FLOAT")
  expect(part).toContain("owner.getY() + rise * scale,")
})

/**
 * The fields and the lookup of a class as plain Java, run with the JDK: what the server reads must be what `followedAt` reads. On every target, with its JDK
 * and mapped to its game version (`rewriteJava`): the lookup names nothing of a loader or a version, and reads the same on all three.
 */
for (const target of ["fabric-1.21.1-official", "forge-1.20.1", "neoforge-1.21.1"] as const)
  test.skipIf(!hasTargetJavac(target))(`${target}: the server's lookup, run as Java, reads the table as followedAt does`, async () => {
  const table = hitboxFollow(giantHitbox, giantDesign, giantAbilities)!
  const source = hitboxSource(giantHitbox, false, { table, abilities: true, busy: "false" })
  const lookup = source.methods.slice(source.methods.indexOf("    /** How far part"), source.methods.indexOf("    @Override public void aiStep()")).replace("@Override ", "")
  const probes = [0, 1, 3, 4, 7, 22, 23, 24, 33, 59, 60, 61, 95, 400].flatMap((tick) => table.motions.flatMap((_, motion) => [0, 3, 6].map((index) => ({ tick: tick + 0.25, motion, index }))))
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-follow-java-"))
  roots.push(root)
  await writeFile(
    path.join(root, "Probe.java"),
    genTarget(target.replace(/-official$/, "")).version.rewriteJava(`public class Probe {
${source.fields.slice(source.fields.indexOf("    // ---- parts that follow"))}
${lookup}
    public static void main(String[] args) {
        Probe probe = new Probe();
        StringBuilder out = new StringBuilder();
        double[][] probes = {${probes.map((probe) => `{${probe.motion}, ${probe.tick}, ${probe.index}}`).join(", ")}};
        for (double[] at : probes) {
            probe.hitboxMotion = (int) at[0];
            probe.hitboxTick = at[1];
            float[] moved = probe.hitboxMoved((int) at[2]);
            out.append(moved[0]).append(' ').append(moved[1]).append(' ').append(moved[2]).append('\\n');
        }
        System.out.print(out);
    }
}
`),
  )
  const javac = Bun.spawnSync([targetJdkTool(target, "javac"), "-d", root, path.join(root, "Probe.java")])
  expect(javac.stderr.toString()).toBe("")
  const run = Bun.spawnSync([targetJdkTool(target, "java"), "-cp", root, "Probe"])
  const rows = run.stdout.toString().trim().split(/\r?\n/).map((line) => line.split(" ").map(Number))
  expect(rows.length).toBe(probes.length)
  probes.forEach((probe, at) => {
    const expected = followedAt(table, probe.index, probe.motion, probe.tick)!
    expect(Math.abs(rows[at]![0]! - expected.forward)).toBeLessThan(1e-4)
    expect(Math.abs(rows[at]![1]! - expected.up)).toBeLessThan(1e-4)
    expect(Math.abs(rows[at]![2]! - expected.left)).toBeLessThan(1e-4)
  })
}, 120000)

test.skipIf(!OFFICIAL)("the generated tree of a six-armed giant whose hands follow, with a step and a way out when stuck, compiles on the official names", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-giant-walker-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const walker = EntitySchema.parse({ ...sample.entities[0]!, abilities: giantAbilities, hitbox: giantHitbox })
  const saved = await saveProject(directory, { ...sample, entities: [walker] } as never, sample.revision)
  await putModelAsset(directory, { entity_id: walker.id, data: { design: giantDesign }, origin: "example", expectedRevision: saved.revision })
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(directory, source, TEMPLATE)
  expect(built.findings.filter((finding) => finding.stops)).toEqual([])
  const part = await Bun.file(path.join(source, "src/main/java/com/minemods/content_azure_sample/entity/StudioPart.java")).text()
  expect(part).toContain("hitboxMoved")
  const compiled = (await compileTreeFor("fabric-1.21.1-official", source))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 240000)

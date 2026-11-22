import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { openProject, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { createTargetAbilitySample } from "../script/target-ability-sample"
import { ABILITY_INSTRUCTIONS, abilityWords, shapeFaces, shapeGap, warnEscape } from "../src/creature-abilities"
import { dashForceIssues } from "../src/ability-dash"
import { AbilitySchema, shapeInner, shapeKind, type Ability } from "../src/entity-runtime"
import { compileAbilityWarn } from "../src/fabric/ability-warn"
import { compileEntity } from "../src/fabric/entity"
import { genTarget } from "../src/platform/target"
import { fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * A hollow arc (`inner`): nobody wholly within `inner` of its middle is hit, so a full circle with an inner radius is a ring — 蚩尤's 棒震, a shockwave from 4 to 10 blocks
 * to be jumped over or stood inside of. An arc without `inner` is what it always was, to the byte of its Java.
 */

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const [slam] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability]
const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const entityPath = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const java = (abilities: Ability[]) => String(compileEntity({ ...plain, abilities } as never)[entityPath])

const ringShape = { type: "arc", reach: 10, angle: 360, low: -0.5, high: 0.7, inner: 4 } as const
// Round itself: the 棒震 shockwave, low enough to jump over.
const quake = AbilitySchema.parse({ ...slam, id: "quake", name: "棒震", hits: [{ ...slam.hits[0]!, shape: ringShape }], events: [] })
// The same ring put down at the target's feet and warned of: the warning draws its inner edge too.
const placed = AbilitySchema.parse({
  ...slam,
  id: "placed",
  name: "落环",
  start: { ...slam.start, min_distance: 3, max_distance: 14 },
  hits: [{ ...slam.hits[0]!, at: Math.max(slam.hits[0]!.at, 1), shape: ringShape, place: "target", warn: { seconds: 0.8, look: "ring", color: "red" } }],
  events: [],
})

test("an arc may be hollowed by an inner radius smaller than its reach; it is a ring by its kind, every other shape is what it was", () => {
  expect(quake.hits[0]!.type === "area" && quake.hits[0]!.shape).toMatchObject({ type: "arc", inner: 4 })
  const refused = AbilitySchema.safeParse({ ...slam, hits: [{ ...slam.hits[0]!, shape: { ...ringShape, inner: 10 } }] }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  expect(refused).toContain("内半径（inner）要比外半径（reach）小")
  expect(AbilitySchema.safeParse({ ...slam, hits: [{ ...slam.hits[0]!, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 2, inner: 1 } }] }).success).toBe(false)
  expect(shapeKind(ringShape)).toBe("ring")
  expect(shapeKind({ type: "arc", reach: 3 })).toBe("arc")
  expect(shapeKind({ type: "arc", reach: 3, inner: 0 })).toBe("arc")
  expect(shapeInner({ type: "box" })).toBe(0)
})

test("a dash sweeps its hit along, so a hollow arc is refused there", () => {
  const charge = (inner?: number) => ({
    ...slam,
    id: "charge",
    hits: [{ ...slam.hits[0]!, at: slam.windup, shape: { type: "arc", reach: 2, angle: 120, low: 0, high: 2, ...(inner === undefined ? {} : { inner }) } }],
    moves: [{ type: "dash", from: slam.windup, to: slam.length, speed: 40, distance: 4, aim: "locked_at_windup", stop_at_wall: true, hit: 0 }],
    events: [],
  })
  const said = (ability: unknown) => AbilitySchema.safeParse(ability).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  expect(said(charge(1))).toContain("中间空心（inner）没有意义")
  // The same dash with a plain arc is what it always was.
  expect(said(charge())).not.toContain("inner")
  expect(dashForceIssues(AbilitySchema.parse(charge()))).toEqual([])
})

test("the words say where the hollow is, and the instructions tell an outside AI how to write a ring", () => {
  expect(abilityWords.hit(quake.hits[0]!)).toContain("身边一圈 4 到 10 格（4 格以内是空的，站在里面打不到）")
  expect(abilityWords.hit(placed.hits[0]!)).toContain("内半径 4、外半径 10 格的一圈环")
  expect(ABILITY_INSTRUCTIONS).toContain("{type:\"arc\", reach, angle, low, high, inner}")
})

test("the pictures measure and draw the hollow: nothing in the middle, the band hit, the inner wall drawn", () => {
  // shapeGap takes a point of the viewport (model pixels: 16 a block; ahead is -Z).
  const at = (forward: number) => [0, 0, -forward * 16] as [number, number, number]
  expect(shapeGap(ringShape, at(0))).toBeCloseTo(4 * 16, 5)
  expect(shapeGap(ringShape, at(2))).toBeCloseTo(2 * 16, 5)
  expect(shapeGap(ringShape, at(6))).toBe(0)
  expect(shapeGap(ringShape, at(12))).toBeCloseTo(2 * 16, 5)
  const full = shapeFaces({ type: "arc", reach: 10, angle: 360, low: -0.5, high: 0.7 })
  const ring = shapeFaces(ringShape)
  const radii = (faces: number[][][]) => new Set(faces.flat().map((point) => Math.round(Math.hypot(point[0]!, point[2]!) / 16)))
  expect([...radii(ring)].sort((a, b) => a - b)).toEqual([4, 10])
  expect(radii(full).has(4)).toBe(false)
  // A part of a ring closes its two ends from the inner edge, not from the middle.
  const part = shapeFaces({ ...ringShape, angle: 120 })
  expect(part.flat().some((point) => Math.hypot(point[0]!, point[2]!) < 1)).toBe(false)
  // Standing in the middle of the band, a player walks out of it in half its width.
  expect(warnEscape(ringShape)).toBe(3.3)
  expect(warnEscape({ type: "arc", reach: 10, angle: 360, low: 0, high: 1 })).toBe(10.3)
})

test("the generated Java tests a ring with its own methods and sends its inner radius in the warning; a plain arc's Java is untouched", () => {
  const round = java([quake])
  expect(round).toContain("abilityInRing(victim, 4.0, 10.0, 180.0, -0.5, 0.7)")
  expect(round).toContain("private boolean abilityInRing(LivingEntity victim, double inner, double reach, double half, double low, double high)")
  expect(round).toContain("flat + wide <= inner")
  expect(round).not.toContain("private boolean abilityInArc(")
  const fixed = java([placed])
  expect(fixed).toContain("abilityInRingAt(victim, 0, 4.0, 10.0, 180.0, -0.5, 0.7)")
  expect(fixed).toMatch(/abilityWarn\(0, 2, 10\.0f, 180\.0f, -0\.5f, 0\.7f, 4\.0f, 0\.0f, /)
  const old = java([slam])
  expect(old).not.toContain("Ring")
  const client = String(compileAbilityWarn({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", hollow: true }).files["src/main/java/com/minemods/content_golem_mod/client/StudioWarnClient.java"])
  expect(client).toContain("double inner = arc ? Math.max(0.0, Math.min(warn.e() * scale, radius)) : 0.0;")
})

test("a project with no warned hollow arc gets the two warning classes it always did, to the byte, on all three targets (found differing on a real project, r13 against r14)", () => {
  // The digests are of the generator on the main line before arcs could be hollow (b8fd1af, 2026-11-17). The ring-hit branch had changed the two classes for every project that
  // warns of a hit, hollow or not (a comment and how the client draws an arc's sides: the same picture when `inner` is 0, other text). A project whose creature warned of an arc
  // was the one kind none of the earlier byte-for-byte checks held, so it went out in r14.
  const input = { modId: "old_guard", packageName: "com.minemods.content_old_guard" }
  const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
  const pinned = { "fabric-1.21.1": "60897fa992fd701a6886b5036c645f794eee4ec826f45ceec04b4d9ae5c42679", "forge-1.20.1": "c78dac45d8988e9c270d0a3ffaefd9432ef8c9a50fa886011ba58d0d5ad74039", "neoforge-1.21.1": "c78dac45d8988e9c270d0a3ffaefd9432ef8c9a50fa886011ba58d0d5ad74039" } as const
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
    expect([target, sha(compileAbilityWarn(input, genTarget(target)).files)]).toEqual([target, pinned[target]])
    expect([target, sha(compileAbilityWarn({ ...input, hollow: false }, genTarget(target)).files)]).toEqual([target, pinned[target]])
    // With one, the classes that draw the inner edge: other text.
    const hollow = compileAbilityWarn({ ...input, hollow: true }, genTarget(target)).files
    expect(sha(hollow)).not.toBe(pinned[target])
    expect(Object.values(hollow).some((text) => String(text).includes("double inner = arc ?"))).toBe(true)
  }
})

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }

test("the build hands the hollow drawing only to a project that warns of a hollow arc", async () => {
  const client = async (hits: Ability[]) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-ring-warn-"))
    roots.push(root)
    const directory = path.join(root, "project")
    await createTargetAbilitySample(directory, "forge-1.20.1")
    const project = await openProject(directory)
    const [first, ...rest] = project.entities
    await saveProject(directory, { ...project, entities: [{ ...first!, abilities: hits, combos: [] }, ...rest] }, project.revision)
    const source = path.join(root, "source")
    await mkdir(source)
    await assembleBuildSource(directory, source, TEMPLATE)
    const file = (await readdir(source, { recursive: true, withFileTypes: true })).find((entry) => entry.isFile() && entry.name === "StudioWarnClient.java")!
    return readFile(path.join(file.parentPath, file.name), "utf8")
  }
  // The same warned hit with its middle filled in: a plain arc, drawn by the classes from before.
  const solid = AbilitySchema.parse({ ...placed, hits: placed.hits.map((hit) => (hit.type === "area" && hit.shape.type === "arc" ? { ...hit, shape: { ...hit.shape, inner: undefined } } : hit)) })
  expect(await client([solid])).not.toContain("double inner")
  expect(await client([placed])).toContain("double inner = arc ?")
  // A hollow arc nobody is warned of (the ring round itself) draws nothing, so it does not ask for them either.
  expect(await client([quake, solid])).not.toContain("double inner")
}, 120000)

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test.skipIf(!hasTargetJavac(CLASSPATH[target]))(`${target}: a project whose creature has a ring round itself and a warned ring at its target builds, and the whole tree compiles`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-ring-"))
    roots.push(root)
    const directory = path.join(root, "雷鸣石窟")
    await createTargetAbilitySample(directory, target)
    const project = await openProject(directory)
    const [first, ...rest] = project.entities
    await saveProject(directory, { ...project, entities: [{ ...first!, abilities: [quake, placed], combos: [] }, ...rest] }, project.revision)
    const source = path.join(root, "source")
    await mkdir(source)
    await assembleBuildSource(directory, source, TEMPLATE)
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { saveProject } from "../src/project"
import { reconcile } from "../src/reconcile"
import { abilityFault } from "@minemods/studio-ai/making"
import { BuildStop } from "../src/build-stop"
import { codedWords, stopWords } from "../src/coded-errors"
import { BONE_FAULT_MARK, abilityHitShapes, abilityIssues, abilityTimingIssues, boneIssues, hitLines } from "../src/creature-abilities"
import { AbilitySchema, type Ability } from "../src/entity-runtime"
import { reviewAsset } from "../src/acceptance"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { compileEntity } from "../src/fabric/entity"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const flat = (color: string) => ({ north: { color }, south: { color }, east: { color }, west: { color }, up: { color }, down: { color } })
const rest = { time: 0, rotation: [0, 0, 0] as [number, number, number] }
const ability = (over: Record<string, unknown>) =>
  AbilitySchema.parse({
    id: "act",
    name: "出手",
    clip: "act",
    windup: 0.08,
    length: 0.9,
    facing: "track",
    hits: [{ type: "area", at: 0.45, shape: { type: "arc", reach: 2.5, angle: 120, low: -0.5, high: 2.5 }, hits: "everyone", damage: 4, knockback: 0.4, effects: [] }],
    moves: [],
    start: { min_distance: 0, max_distance: 16, line_of_sight: true, cooldown: 1, weight: 1 },
    stopped_by_hurt: false,
    events: [],
    ...over,
  }) as Ability

// ---- a mechanical crossbow: its bolt is pushed forward and held, and then goes back to rest ----

const turret = (keys: { time: number; position: [number, number, number] }[]) => ({
  bones: [
    { name: "base", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ name: "plate", origin: [-6, 0, -6], size: [12, 2, 12], faces: flat("#555555") }] },
    { name: "stand", parent: "base", pivot: [0, 2, 0], rotation: [0, 0, 0], cubes: [{ name: "post", origin: [-1, 2, -1], size: [2, 10, 2], faces: flat("#555555") }] },
    { name: "crossbow_body", parent: "stand", pivot: [0, 12, 0], rotation: [0, 0, 0], cubes: [{ name: "bow", origin: [-8, 11, -4], size: [16, 2, 8], faces: flat("#553333") }] },
    { name: "bolt_rail", parent: "crossbow_body", pivot: [0, 13, 0], rotation: [0, 0, 0], cubes: [{ name: "bolt", origin: [-0.5, 13, -6], size: [1, 1, 8], faces: flat("#999999") }] },
  ],
  animations: [{ name: "shoot", length: 0.5, loop: false, channels: [{ bone: "bolt_rail", keyframes: [rest], position: keys }] }],
})
/** Pushed 3 pixels forward between 0.08 and 0.12 s, held to 0.2 s, back at rest by 0.35 s: the shot is the push, the return is only the bolt going back. */
const pushed = turret([
  { time: 0, position: [0, 0, 0] },
  { time: 0.08, position: [0, 0, 0] },
  { time: 0.12, position: [0, 0, -3] },
  { time: 0.2, position: [0, 0, -3] },
  { time: 0.35, position: [0, 0, 0] },
  { time: 0.5, position: [0, 0, 0] },
])
const shot = (at: number, over: Record<string, unknown> = {}) =>
  ability({ id: "turret_shot", clip: "shoot", length: 0.5, hits: [{ type: "shot", at, projectile: "arrow", speed: 1.6, forward: 0, up: 0, damage: 3, bone: "bolt_rail" }], ...over })

test("a shot is at the moment the part reaches its peak forward travel; the part going back to rest is never that moment", () => {
  // The shot where the bolt is pushed: the stroke lands at 0.15 s (the tick after the push ends), 0.03 s from the shot: in time.
  const right = abilityHitShapes(shot(0.12), pushed as never)![0]!
  expect(right.arrives).toBe(0.15)
  expect(hitLines(shot(0.12), right).filter((line) => line.startsWith("对不上"))).toEqual([])
  expect(abilityTimingIssues({ name: "弩炮", behavior: "hostile", abilities: [shot(0.12)] }, pushed as never).filter((issue) => issue.rule === "ability_timing")).toEqual([])
  // Asked for at the reset (0.35 s) it is not found there: the stroke is still the push, and the maker is told to move the shot to it, not the other way round.
  const reset = abilityHitShapes(shot(0.35), pushed as never)![0]!
  expect(reset.arrives).toBe(0.15)
  expect(abilityTimingIssues({ name: "弩炮", behavior: "hostile", abilities: [shot(0.35)] }, pushed as never).find((issue) => issue.rule === "ability_timing")?.fix).toContain("改成 0.15")
  // Whatever the push and the hold are, the return (0.3 to 0.4 s here) is not a candidate.
  for (const hold of [0.2, 0.25]) for (const back of [0.3, 0.35, 0.4]) for (const forward of [0, 0.5]) {
    const clip = turret([{ time: 0, position: [0, 0, 0] }, { time: 0.08, position: [0, 0, 0] }, { time: 0.12, position: [0, 0, -4] }, { time: hold, position: [0, 0, -4] }, { time: back + 0.05, position: [0, 0, 0] }, { time: 0.5, position: [0, 0, 0] }])
    const found = abilityHitShapes(shot(0.12, { hits: [{ type: "shot", at: 0.12, projectile: "arrow", speed: 1.6, forward, up: 0, damage: 3, bone: "bolt_rail" }] }), clip as never)![0]!
    expect(found.arrives).toBe(0.15)
  }
  // A part pushed back for the shot and released (a drawn string): the release is the stroke toward the target, the drawing is not.
  const drawn = turret([{ time: 0, position: [0, 0, 0] }, { time: 0.2, position: [0, 0, 5] }, { time: 0.3, position: [0, 0, 0] }, { time: 0.5, position: [0, 0, 0] }])
  const released = abilityHitShapes(shot(0.3, { windup: 0.2 }), drawn as never)![0]!
  expect(released.arrives).toBe(0.3)
  expect(abilityHitShapes(shot(0.2, { windup: 0.2 }), drawn as never)![0]!.arrives).toBe(0.3)
  // A push too small to see (one pixel) is not a stroke: nothing is claimed about when the shot is.
  const hair = turret([{ time: 0, position: [0, 0, 0] }, { time: 0.1, position: [0, 0, -1] }, { time: 0.2, position: [0, 0, 0] }])
  expect(abilityHitShapes(shot(0.12), hair as never)![0]!.arrives).toBeNull()
})

// ---- a sword swing and a lunge keep their meaning ----

const swordsman = (arm: [number, number, number][], body: { time: number; position: [number, number, number] }[] = []) => ({
  bones: [
    { name: "body", parent: null, pivot: [0, 12, 0], rotation: [0, 0, 0], cubes: [{ name: "torso", origin: [-4, 12, -2], size: [8, 12, 4], faces: flat("#444444") }, { name: "legs", origin: [-4, 0, -2], size: [8, 12, 4], faces: flat("#333333") }] },
    { name: "arm", parent: "body", pivot: [-6, 22, 0], rotation: [0, 0, 0], cubes: [{ name: "sleeve", origin: [-8, 12, -2], size: [4, 12, 4], faces: flat("#666666") }, { name: "sword", origin: [-7, 2, -1], size: [2, 12, 2], faces: flat("#bbbbbb") }] },
  ],
  animations: [
    {
      name: "act",
      length: 0.9,
      loop: false,
      channels: [
        { bone: "arm", keyframes: arm.map((rotation, index) => ({ time: [0, 0.3, 0.45, 0.55, 0.9][index]!, rotation })) },
        ...(body.length ? [{ bone: "body", keyframes: [rest], position: body }] : []),
      ],
    },
  ],
})
const swing = swordsman([[0, 0, 0], [-150, 0, 0], [-60, 0, 0], [-60, 0, 0], [0, 0, 0]])

test("a sword swing lands where the blade comes down, not where the arm goes back, and a swing at the return is still seen to be late", () => {
  const strike = ability({ windup: 0.3, hits: [{ type: "area", at: 0.45, shape: { type: "arc", reach: 2.5, angle: 120, low: -0.5, high: 3 }, hits: "everyone", damage: 4, knockback: 0.4, effects: [] }] })
  expect(abilityHitShapes(strike, swing as never)![0]!.arrives).toBe(0.45)
  expect(hitLines(strike, abilityHitShapes(strike, swing as never)![0]!).filter(abilityFault)).toEqual([])
  const late = ability({ windup: 0.3, hits: [{ type: "area", at: 0.9, shape: { type: "arc", reach: 2.5, angle: 120, low: -0.5, high: 3 }, hits: "everyone", damage: 4, knockback: 0.4, effects: [] }] })
  const found = abilityHitShapes(late, swing as never)![0]!
  expect(found.arrives).toBe(0.45)
  expect(abilityTimingIssues({ name: "剑士", behavior: "hostile", abilities: [late] }, swing as never).find((issue) => issue.rule === "ability_timing")?.fix).toContain("改成 0.45")
})

test("a lunge of the body lands at the end of the lunge, and the step back is not a candidate", () => {
  const lunge = swordsman([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], [
    { time: 0, position: [0, 0, 0] },
    { time: 0.3, position: [0, 0, 0] },
    { time: 0.45, position: [0, 0, -12] },
    { time: 0.55, position: [0, 0, -12] },
    { time: 0.9, position: [0, 0, 0] },
  ])
  const strike = ability({ windup: 0.3, hits: [{ type: "area", at: 0.45, shape: { type: "arc", reach: 2.5, angle: 120, low: -0.5, high: 3 }, hits: "everyone", damage: 4, knockback: 0.4, effects: [] }] })
  expect(abilityHitShapes(strike, lunge as never)![0]!.arrives).toBe(0.45)
  const late = ability({ windup: 0.3, hits: [{ type: "area", at: 0.9, shape: { type: "arc", reach: 2.5, angle: 120, low: -0.5, high: 3 }, hits: "everyone", damage: 4, knockback: 0.4, effects: [] }] })
  expect(abilityHitShapes(late, lunge as never)![0]!.arrives).toBe(0.45)
  // The same lunge as a hit that counts from the body itself (a bone, a ball at it): still the lunge forward, never the step back.
  const bodyHit = ability({ windup: 0.3, hits: [{ type: "area", at: 0.45, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 1 }, hits: "everyone", damage: 4, knockback: 0.4, effects: [], bone: "body" }] })
  expect(abilityHitShapes(bodyHit, lunge as never)![0]!.arrives).toBe(0.45)
  expect(abilityHitShapes(ability({ windup: 0.3, hits: [{ ...bodyHit.hits[0]!, at: 0.9 }] }), lunge as never)![0]!.arrives).toBe(0.45)
})

// ---- a part the model lacks, said by one function wherever a document names one ----

// The three motions every creature's model must have, each moving the base a little.
const crossbow = { ...pushed, animations: [...pushed.animations, ...["idle", "walk", "hurt"].map((name) => ({ name, length: 1, loop: name !== "hurt", channels: [{ bone: "crossbow_body", keyframes: [rest, { time: 1, rotation: [2, 0, 0] as [number, number, number] }] }] }))] }
const named = (bone: string, id = "turret_shot") => shot(0.12, { id, hits: [{ type: "shot", at: 0.12, projectile: "arrow", speed: 1.6, forward: 0, up: 0, damage: 3, bone }] })

test("every place a creature names a part of its model is checked by one function: the missing part, and the ones that exist", () => {
  const creature = { name: "弩炮", behavior: "hostile", abilities: [named("bolt_rail", "first"), named("Bolt-Rail", "second")], hitbox: { parts: [{ name: "弩身", forward: 0, up: 1, left: 0, width: 1, height: 1, bone: "crossbow" }, { name: "底座", forward: 0, up: 0, left: 0, width: 1, height: 1, bone: "base" }] } }
  const issues = boneIssues(creature, pushed as never)
  expect(issues.map((issue) => [issue.ability, issue.stops])).toEqual([["second", true], ["hitbox:弩身", false]])
  const [hit, box] = issues
  expect(hit!.text).toContain("第 1 次出手")
  expect(hit!.text).toContain("「Bolt-Rail」")
  expect(hit!.text).toContain("模型里没有这个部件")
  // A near miss in spelling is named, and the parts that exist are listed.
  expect(hit!.text).toContain("模型里有名字很像的「bolt_rail」")
  // A slip of the keys is a near miss too.
  expect(boneIssues({ name: "弩炮", abilities: [named("bolt_rial")] }, pushed as never)[0]!.text).toContain("模型里有名字很像的「bolt_rail」")
  expect(boneIssues({ name: "弩炮", abilities: [named("head")] }, pushed as never)[0]!.text).not.toContain("名字很像")
  expect(hit!.fix).toContain("base、stand、crossbow_body、bolt_rail")
  expect(box!.text).toContain("「crossbow」")
  expect(box!.fix).toContain("crossbow_body")
  // The model is never asked about what it was not asked: every part that is named exists, nothing is said.
  expect(boneIssues({ name: "弩炮", abilities: [named("bolt_rail")] }, pushed as never)).toEqual([])
  // The abilities' findings, the draft's and the look's lines are this function's, word for word.
  const found = abilityIssues(creature, crossbow.animations, crossbow as never).filter((issue) => issue.rule === "ability_bone")
  expect(found.map((issue) => `${issue.text}${issue.fix}`)).toEqual(issues.map((issue) => `${issue.text}${issue.fix}`))
  expect(abilityIssues({ ...creature, abilities: [] }, null, crossbow as never).map((issue) => issue.rule)).toEqual(["ability_bone"])
  expect(abilityFault(`${BONE_FAULT_MARK}${hit!.text}`)).toBe(true)
})

const entity = (bone: string) => ({
  kind: "entity" as const,
  name: "弩炮",
  description: "",
  health: 20,
  speed: 0.2,
  attack_damage: 0,
  behavior: "hostile" as const,
  model_asset_id: "11111111-1111-4111-8111-111111111111",
  stationary: { reason: "守着" },
  abilities: [named(bone)],
  runtime: { spawn: null, explosion: null, movement: "direct" as const, armor: 0, charging_armor: 0, texture_asset_id: null },
})

test("the acceptance of a creature refuses an ability that names a part its model lacks, and the build stops in the generator's own words", () => {
  const project = { id: "p", name: "x", mod_id: "mod", workspace: { assets: [] }, items: [], blocks: [], entities: [] } as never
  const asset = (document: unknown) => ({ id: "22222222-2222-4222-8222-222222222222", title: "弩炮", document }) as never
  const worn = { id: "11111111-1111-4111-8111-111111111111", title: "弩炮模型", document: { kind: "model", ...crossbow } } as never
  const refused = reviewAsset(project, asset(entity("bolt_rial")), { against: [worn] } as never)
  const finding = refused.findings.find((value) => value.rule === "ability_bone_missing")
  expect(finding).toBeDefined()
  expect(finding!.message).toContain("「bolt_rial」")
  expect(finding!.fix).toContain("crossbow_body")
  expect(refused.passed).toBe(false)
  const fine = reviewAsset(project, asset(entity("bolt_rail")), { against: [worn] } as never)
  expect(fine.findings.map((value) => value.rule)).not.toContain("ability_bone_missing")

  // The build: a typed stop, whose message is the sentence, and which the layer above can tell from any other failure.
  const slam = AbilitySchema.parse(golemAbilities[0])
  const input = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "傀儡", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign, abilities: [{ ...slam, hits: [{ ...slam.hits[0]!, bone: "arm_lef" }] }] }
  const error = (() => {
    try {
      compileEntity(input as never)
    } catch (caught) {
      return caught
    }
  })()
  expect(error).toBeInstanceOf(BuildStop)
  expect((error as BuildStop).rule).toBe("ability_bone")
  expect((error as BuildStop).message).toContain("「arm_lef」")
  expect((error as BuildStop).message).toContain("arm_left")
  expect(stopWords(error, { entities: [], workspace: { assets: [] } })).toBe((error as BuildStop).message)
  // Any other error is not worded here: its message may carry a key or a path.
  expect(stopWords(new Error("EACCES: /home/secret"), { entities: [], workspace: { assets: [] } })).toBeNull()
})

test("every coded stop of the generator layer has its own words", () => {
  const none = () => null
  expect(codedWords("GAMEPLAY_FILE_CONFLICT:gameplay/a/main.java", none)!.text).toContain("gameplay/a/main.java")
  expect(codedWords("GAMEPLAY_TEXT_CONFLICT:item.mod.sword", none)!.text).toContain("item.mod.sword")
  expect(codedWords("GAMEPLAY_SLUG_CONFLICT:11111111-1111-4111-8111-111111111111", () => ({ kind: "gameplay", name: "夜行" }))!.text).toContain("玩法「夜行」")
  expect(codedWords("GESTURE_KEY_CONFLICT:11111111-1111-4111-8111-111111111111", none)!.text).toContain("触发的按键")
  expect(codedWords("GESTURE_TEMPLATE_ANCHOR_MISSING:build.gradle", none)!.text).toContain("build.gradle")
  expect(codedWords("NOT_A_CODE:whatever", none)).toBeNull()
})

test("a project whose creature names a part its model lacks is stopped as a whole, in words, and is reconciled as a finding that stops", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-bones-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const golem = sample.entities[0]!
  const lost = { ...golem, abilities: golem.abilities!.map((one, index) => (index === 0 ? { ...one, hits: one.hits.map((hit) => ({ ...hit, bone: "arm_lef" })) } : one)) }
  const saved = await saveProject(directory, { ...sample, entities: [lost] } as never, sample.revision)
  const source = path.join(root, "source")
  await mkdir(source)
  const stopped = await assembleBuildSource(directory, source, TEMPLATE).then(() => null, (error: unknown) => error)
  expect(stopped).toBeInstanceOf(BuildStop)
  expect((stopped as BuildStop).message).toContain("「arm_lef」")
  expect((stopped as BuildStop).message).toContain("arm_left")
  // What a code check names the creature as: the person's sentence, with the creature's name found in the project.
  expect(stopWords(stopped, saved)).toBe((stopped as BuildStop).message)
  // Reconciliation says the same sentence as a finding that stops (what the card and the draft show).
  const findings = reconcile(saved, { animations: { [lost.id]: fightingGolemDesign.animations.map((clip) => clip.name) } })
  expect(findings.filter((finding) => finding.rule === "ability_bone")).toMatchObject([{ stops: true, about: { kind: "entity", id: lost.id } }])
})

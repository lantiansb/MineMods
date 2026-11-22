import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { looksAt } from "@minemods/studio-ai/making"
import { assembleBuildSource } from "../src/build-source"
import { HITBOX_FIT, HITBOX_INSTRUCTIONS, hitboxBoxes, hitboxFault, hitboxFit, hitboxLines, hitboxLooked, legacyCore, proposedCore } from "../src/creature-hitbox"
import { CREATURE_LIFE_CAPABILITY } from "../src/creature-capability"
import { EntitySchema, HITBOX_LIMITS, HitboxSchema } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { compileHitboxParts, PART_RUNTIME } from "../src/fabric/hitbox"
import { MODULES } from "../src/workspace-modules"
import { createDataGameplaySample, fightingGolemDesign, longCreatureDesign, longCreatureHitbox } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const long = ModelDesignSchema.parse(longCreatureDesign)
const golem = ModelDesignSchema.parse(fightingGolemDesign)
const boxes = HitboxSchema.parse(longCreatureHitbox)
const plain = { modId: "long_mod", packageName: "com.minemods.content_long_mod", id: "creature", name: "长脊兽", health: 30, speed: 0.2, attack_damage: 0, behavior: "passive" as const, model: longCreatureDesign }
const java = (files: Record<string, string | Uint8Array>, name = "entity/StudioCreature") => String(files[`src/main/java/com/minemods/content_long_mod/${name}.java`])

test("solidity is opt-in per part and keeps the original combat path", () => {
  const parts = boxes.parts!
  const solid = HitboxSchema.parse({ ...boxes, parts: [{ ...parts[0], solid: true }, ...parts.slice(1)] })
  const explicitlyOff = HitboxSchema.parse({ ...boxes, parts: parts.map((part) => ({ ...part, solid: false })) })
  expect(compileEntity({ ...plain, hitbox: explicitlyOff })).toEqual(compileEntity({ ...plain, hitbox: boxes }))
  expect(HitboxSchema.safeParse({ ...solid, parts: [{ ...parts[0], solid: "yes" }] }).error?.issues[0]?.message).toContain("部位是否实心")
  expect(hitboxBoxes(solid, long).map((box) => box.solid === true)).toEqual([false, true, false, false, false])
  const base = compileHitboxParts({ modId: plain.modId, packageName: plain.packageName })
  const compiled = compileHitboxParts({ modId: plain.modId, packageName: plain.packageName, solid: true })
  expect(Object.keys(base.files).some((file) => file.endsWith("StudioSolidBody.java"))).toBe(false)
  expect(java(compiled.files, "entity/StudioPart")).toContain("builder.define(SOLID, false)")
  expect(java(compiled.files, "entity/StudioPart")).toContain("public boolean isPickable() { return true; }")
  expect(java(compiled.files, "entity/StudioPart")).toContain("creature.getRootVehicle()")
  expect(java(compileEntity({ ...plain, hitbox: solid }))).toContain("StudioSolidBody.clear(this, hitboxParts, solidBoxes)")
})

test("collision boxes are one optional field: absent the creature is what it was, byte for byte", () => {
  const old = { id: "11111111-1111-4111-8111-111111111111", name: "长脊兽", description: "", health: 20, speed: 0.25, attack_damage: 3, behavior: "passive", model_asset_id: null }
  expect(JSON.stringify(EntitySchema.parse(old))).toBe(JSON.stringify(old))
  expect(EntitySchema.parse({ ...old, hitbox: longCreatureHitbox }).hitbox?.parts).toHaveLength(4)
  expect(HitboxSchema.safeParse({ core: { width: 1, height: 1 }, parts: Array.from({ length: HITBOX_LIMITS.parts + 1 }, (_, index) => ({ ...longCreatureHitbox.parts[0]!, name: `p${index}` })) }).success).toBe(false)
  expect(HitboxSchema.safeParse({ core: { width: 1, height: 1 }, parts: [longCreatureHitbox.parts[0], longCreatureHitbox.parts[0]] }).error?.issues[0]?.message).toContain("不能用同一个名字")
  expect(HitboxSchema.safeParse({ core: { width: 1, height: 1, eye_height: 2 } }).error?.issues[0]?.message).toContain("eye_height")
  const before = compileEntity(plain)
  expect(compileEntity({ ...plain, hitbox: null })).toEqual(before)
  // The one box it always had: square, as wide as the model reaches from its middle, lengthways here.
  expect(legacyCore(long)).toEqual({ width: 5.5, height: 1 })
  expect(java(before, "StudioContent")).toContain(".sized(5.5000f, 1.0000f).build(")
  expect(java(before)).not.toContain(PART_RUNTIME.entity)
})

test("a solid core uses its live body box even without parts", () => {
  const body = { core: { width: 3, height: 2 } }
  expect(compileEntity({ ...plain, hitbox: { core: { ...body.core, solid: false } } })).toEqual(compileEntity({ ...plain, hitbox: body }))
  const solid = { core: { ...body.core, solid: true } }
  expect(java(compileEntity({ ...plain, hitbox: solid }))).toContain("StudioSolidBody.clear(this, null, solidBoxes)")
  expect(hitboxBoxes(solid, long)[0]?.solid).toBe(true)
})

test("the fit is measured: one square box around a long body is mostly air, the narrow one leaves it uncovered, boxes along it fit", () => {
  const legacy = hitboxFit(null, long)
  expect(legacy.rest).toMatchObject({ outside: 0, far: 0 })
  expect(legacy.rest.empty).toBeGreaterThan(0.85)
  expect(legacy.clear[0]!.clear!.side).toBeGreaterThan(2)
  expect(legacy.faults).toEqual([{ fault: "air", reason: null }])
  expect(hitboxLines(legacy).filter(hitboxFault).join("")).toContain('core {"width":1.125,"height":0.9375}')
  // Never the long side: the suggestion is the body's narrow width, and it says the rest needs boxes of its own.
  expect(proposedCore(long)).toEqual({ width: 1.125, height: 0.9375, split: true })
  const narrow = hitboxFit({ core: longCreatureHitbox.core }, long)
  expect(narrow.faults).toEqual([{ fault: "out", reason: null }])
  expect(narrow.rest.outside).toBeGreaterThan(0.5)
  expect(narrow.rest.far).toBeGreaterThan(1.5)
  const fitted = hitboxFit(boxes, long)
  expect(fitted.faults).toEqual([])
  expect(fitted.rest.far).toBeLessThan(HITBOX_FIT.out)
  expect(Math.max(...fitted.clear.flatMap((entry) => Object.values(entry.clear!)))).toBeLessThan(HITBOX_FIT.air)
  expect(hitboxLines(fitted).some(hitboxFault)).toBe(false)
  // The tail swings when it walks. Its box names the tail's bone, so it follows (任务二): no moment of walking leaves more out than standing does.
  expect(fitted.moving).toBeNull()
  // A box that names no bone stays where it is stated: the tail's swing is the worst moment, said as a fact.
  const unboned = hitboxFit(HitboxSchema.parse({ ...boxes, parts: boxes.parts!.map(({ bone: _bone, ...part }) => part) }), long)
  expect(unboned.moving?.clip).toBe("walk")
  // A misfit that is meant is said with its reason and no longer has to be answered.
  const meant = hitboxLines(hitboxFit({ core: longCreatureHitbox.core, justified: [{ what: "out", reason: "只有躯干能被打中" }] }, long))
  expect(meant.some(hitboxFault)).toBe(false)
  expect(meant.join("")).toContain("只有躯干能被打中")
  // A box that holds nothing is a misfit too.
  expect(hitboxFit({ core: longCreatureHitbox.core, parts: [...longCreatureHitbox.parts, { name: "空的", forward: 0, up: 5, left: 3, width: 1, height: 1 }] }, long).faults).toEqual([{ fault: "air", reason: null }])
})

test("a body too long for any one square is told so: the suggestion is its narrow width and the rest needs boxes of its own", () => {
  // A cuboid a block wide and eight long: no square stands clear of its sides by at most `air` and falls short of its ends by at most `out`.
  const rail = { animations: [], bones: [{ name: "body", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ name: "rail", origin: [-8, 0, -64], size: [16, 16, 128] }] }] } as unknown as Parameters<typeof proposedCore>[0] & { animations: [] }
  const suggested = proposedCore(rail)
  expect(suggested).toMatchObject({ split: true })
  expect(suggested.width).toBeLessThan(1)
  const narrow = hitboxFit({ core: { width: suggested.width, height: suggested.height } }, rail)
  expect(narrow.faults).toEqual([{ fault: "out", reason: null }])
  expect(hitboxLines(narrow).filter(hitboxFault).join("")).toContain("用 parts 给露在外面的部位加箱子")
})

test("a small squarish creature passes with the one box it always had, and is not looked at for it", () => {
  const fit = hitboxFit(null, golem)
  expect(fit.faults).toEqual([])
  expect(proposedCore(golem).split).toBe(false)
  expect(hitboxLooked({}, golem)).toBe(false)
  expect(hitboxLooked({}, long)).toBe(true)
  expect(hitboxLooked({ hitbox: boxes }, null)).toBe(true)
  expect(looksAt({ kind: "entity" }, hitboxLooked({}, golem))).toBe(false)
  expect(looksAt({ kind: "entity" }, hitboxLooked({}, long))).toBe(true)
  expect(looksAt({ kind: "entity", hitbox: boxes })).toBe(true)
  // The boxes in the model's own space: front is -Z, the creature's own left is -X.
  const head = hitboxBoxes(boxes, long)[1]!
  expect([head.name, head.core, ...head.min, ...head.max].map((value) => (typeof value === "number" ? Number(value.toFixed(4)) : value))).toEqual(["头", false, -9.6, 2.4, -28, 9.6, 16, -8.8])
})

test("the generated creature stands in its stated core and keeps its parts; a part is a box that hands everything to its creature", () => {
  const files = compileEntity({ ...plain, hitbox: { ...longCreatureHitbox, core: { ...longCreatureHitbox.core, eye_height: 0.7 } } })
  expect(java(files, "StudioContent")).toContain(".sized(1.1000f, 1.0000f).eyeHeight(0.7000f).build(")
  const creature = java(files)
  expect(creature).toContain(`implements GeoEntity, ${PART_RUNTIME.entity}.Owner {`)
  expect(creature).toContain("{1.15f, 0.15f, 0f, 1.2f, 0.85f},")
  expect(creature).toContain("@Override public void aiStep() {")
  expect(creature).toContain("for (StudioPart part : hitboxParts) if (part != null) part.discard();")
  // What its abilities sweep is living things only, and a part is not one: no swing reaches the same creature twice, none its own.
  expect(creature).not.toContain("getOtherEntities")
})

test("the words an AI is given say what each box is for, that parts follow the body only, and how the fit is answered", () => {
  expect(MODULES.entity.instructions).toContain(HITBOX_INSTRUCTIONS)
  // The capability list says the same limits in its own words.
  expect(CREATURE_LIFE_CAPABILITY.done.join("")).toContain(`最多 ${HITBOX_LIMITS.parts} 个箱子`)
  expect(CREATURE_LIFE_CAPABILITY.done.join("")).toContain(`边长最多 ${HITBOX_LIMITS.size} 格，step 是它不用跳就能走上去的台阶高度（${HITBOX_LIMITS.step.min} 到 ${HITBOX_LIMITS.step.max} 格`)
  expect(CREATURE_LIFE_CAPABILITY.done.join("")).toContain(`箱子空出 ${HITBOX_FIT.air} 格以上、或者模型露出 ${HITBOX_FIT.out} 格以上`)
  expect(HITBOX_INSTRUCTIONS).toContain(`最多 ${HITBOX_LIMITS.parts} 个`)
  // 任务二: a part that names a bone follows it; one that names none stays where it is stated.
  expect(HITBOX_INSTRUCTIONS).toContain("还会跟着那根骨骼动")
  expect(HITBOX_INSTRUCTIONS).toContain("不写 bone 的部位一直停在写的位置")
  expect(HITBOX_INSTRUCTIONS).toContain("what 写 air、out 或 overlap")
  expect(HITBOX_INSTRUCTIONS).toContain(`step 是它不用跳就能走上去的台阶高度，${HITBOX_LIMITS.step.min} 到 ${HITBOX_LIMITS.step.max} 格`)
  expect(HITBOX_INSTRUCTIONS).toContain("stuck 是大个子卡住时怎么办")
  expect(HitboxSchema.safeParse(JSON.parse(/例（一只身子长的生物）：(\{.*\})。$/.exec(HITBOX_INSTRUCTIONS)![1]!)).success).toBe(true)
})

test.skipIf(!hasTargetJavac(OFFICIAL))("the sample with a long creature builds: one part type for the project, registered beside the creatures, and the whole tree compiles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-hitbox-"))
  roots.push(root)
  const [project, source, bare, bareSource] = ["project", "source", "bare", "bare-source"].map((name) => path.join(root, name)) as [string, string, string, string]
  await Promise.all([project, bare].map((directory) => mkdir(directory)))
  await createDataGameplaySample(project, { chain: true, life: true, abilities: true, effects: true, hitbox: true })
  const built = await assembleBuildSource(project, source, TEMPLATE)
  expect(built.hitboxFiles).toEqual([`com/minemods/content_azure_sample/entity/${PART_RUNTIME.entity}.class`])
  const metadata = JSON.parse(await readFile(path.join(source, "src/main/resources/fabric.mod.json"), "utf8")) as { entrypoints: { main: string[]; client: string[] } }
  expect(metadata.entrypoints.main.at(-1)).toBe(`com.minemods.content_azure_sample.entity.${PART_RUNTIME.table}`)
  expect(metadata.entrypoints.client.at(-1)).toBe(`com.minemods.content_azure_sample.client.${PART_RUNTIME.client}`)
  const part = await readFile(path.join(source, `src/main/java/com/minemods/content_azure_sample/entity/${PART_RUNTIME.entity}.java`), "utf8")
  expect(part).toContain(`public class ${PART_RUNTIME.entity} extends Entity {`)
  expect(JSON.parse(await readFile(path.join(source, "src/main/resources/assets/azure_sample/lang/zh_cn.json"), "utf8"))[`entity.azure_sample.${PART_RUNTIME.registry}`]).toBe("身体部位")
  const compiled = (await compileTreeFor(OFFICIAL, source))!
  expect(compiled.output).not.toContain("error")
  expect(compiled.code).toBe(0)
  // Without the option nothing of it is in the tree.
  await createDataGameplaySample(bare, { chain: true, life: true, abilities: true, effects: true })
  const plainBuilt = await assembleBuildSource(bare, bareSource, TEMPLATE)
  expect(plainBuilt.hitboxFiles).toEqual([])
  expect(await Bun.file(path.join(bareSource, `src/main/java/com/minemods/content_azure_sample/entity/${PART_RUNTIME.entity}.java`)).exists()).toBe(false)
}, 120000)

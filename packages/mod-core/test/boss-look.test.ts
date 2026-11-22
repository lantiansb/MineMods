import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { SHAKE_LIMITS } from "../src/boss-words"
import { abilityShakes, bossLookPlan, shakeCap, shakeCurve, shakeExtended, shakesOf, stageHidden } from "../src/boss-look-words"
import { bossDropPlaces, bossLookIssues } from "../src/boss-look"
import { assembleBuildSource } from "../src/build-source"
import { BOSS_EVENT_INSTRUCTIONS, BOSS_INSTRUCTIONS, bossWords } from "../src/creature-boss"
import { AbilitySchema, BossSchema, bossDropDocumentIssues, type Ability, type Boss } from "../src/entity-runtime"
import { BOSS_RUNTIME, compileBossRuntime } from "../src/fabric/boss-runtime"
import { BOSS_LOOK_RUNTIME } from "../src/fabric/boss-look"
import { compileEntity } from "../src/fabric/entity"
import { genTarget } from "../src/platform/target"
import type { TargetId } from "../src/target/ids"
import { changingAbilities, changingBoss, createTargetBossLookSample, crownedGolemDesign, LOOK_GLOW_ID } from "../script/target-boss-look-sample"
import { golemAbilities } from "../script/data-gameplay-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * Boss 能力 8 (a stronger shake: roll, a pulse of the field of view, falloff, frequency, cap 8) and Boss 能力 10 (a boss's model changing with its phases:
 * bones hidden and shown, a glow fading in, parts that come off): the definition, what an AI is told, what is measured and said, and the Java on all three
 * targets. A project written as before is generated exactly as before.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const design = crownedGolemDesign as unknown as ModelDesign
const boss = BossSchema.parse(changingBoss)
const [slam, burst] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability, Ability]
const shake = { type: "shake" as const, at: 0.7, strength: 2, radius: 16, seconds: 1 }

test("a shake reaches 8 and may roll, change the view, be as strong in its whole radius and shake at its own speed; one written as before is what it was", () => {
  expect(SHAKE_LIMITS).toMatchObject({ cap: 8, legacyCap: 3, strength: { max: 8 } })
  const parsed = (change: Record<string, unknown>) => AbilitySchema.safeParse({ ...slam, events: [{ ...shake, ...change }] }).success
  expect([parsed({ strength: 8 }), parsed({ roll: 10, fov: -10, falloff: "none", frequency: 4 }), parsed({ roll: -1 }), parsed({ frequency: 0.2 })]).toEqual([true, true, false, false])
  // Which shakes need the new runtime: one past the old cap, or one with any new field.
  expect([shakeExtended(shake), shakeExtended({ ...shake, strength: 3 }), shakeExtended({ ...shake, strength: 3.5 }), shakeExtended({ ...shake, frequency: 1 })]).toEqual([false, false, true, true])
  expect(shakeCap([shake])).toBe(3)
  expect(shakeCap([shake, { ...shake, roll: 2 }])).toBe(8)
  // The words: as before for one written as before, with what it adds otherwise.
  expect(bossWords.shake(shake)).toBe("第 0.7 秒 16 格内的玩家屏幕晃动（力度 2，越远越轻，1 秒里逐渐停下）")
  expect(bossWords.shake({ ...shake, strength: 5, roll: 4, fov: 3, falloff: "none", frequency: 1.5 })).toBe("第 0.7 秒 16 格内的玩家屏幕晃动（力度 5，范围内一样强，1 秒里逐渐停下，画面左右转动最多 4 度，视野放大 3 度再慢慢回来（玩家把“视野效果”调小就变小），晃得快（1.5 倍））")
  // What an AI is told carries every bound.
  for (const word of ["roll 0–10", "fov -10–10", "falloff none|linear", "frequency 0.25–4", "strength 0.2–8", "加起来最多 8"]) expect(BOSS_EVENT_INSTRUCTIONS).toContain(word)
})

test("the shake's curve: each shake and their sum at the centre, tick by tick; stacked past the cap is said, with the cap the project's runtime has", () => {
  const twice = AbilitySchema.parse({ ...slam, events: [{ ...shake, strength: 5, roll: 2 }, { ...shake, at: 0.75, strength: 5 }] })
  const curve = shakeCurve(abilityShakes(twice), 8)!
  expect(curve.peak.sum).toBeCloseTo(5 + 5 * (1 - 1 / 20), 5)
  expect(curve.over.length).toBeGreaterThan(0)
  expect(curve.points[0]!.sum).toBe(0)
  const said = bossLookIssues({ name: "石魔", behavior: "hostile", abilities: [twice] }, null).filter((issue) => issue.rule === "boss_shake_cap")
  expect(said).toHaveLength(1)
  expect(said[0]!.text).toContain("超过了上限 8")
  // Written as before, the old cap holds: two shakes of 2 at once go past 3, and the fix says how to get the new cap.
  const old = AbilitySchema.parse({ ...slam, events: [shake, { ...shake, at: 0.7 }] })
  const legacy = bossLookIssues({ name: "石魔", behavior: "hostile", abilities: [old] }, null).find((issue) => issue.rule === "boss_shake_cap")!
  expect(legacy.text).toContain("超过了上限 3")
  expect(legacy.fix).toContain("上限 8")
  expect(bossLookIssues({ name: "石魔", behavior: "hostile", abilities: [AbilitySchema.parse({ ...slam, events: [shake] })] }, null)).toEqual([])
})

test("the boss's model in each stage: what is hidden, what glows how bright, what comes off", () => {
  const plan = bossLookPlan(boss)!
  expect(plan.bones).toEqual(["arm_left", "head", "crown"])
  // The crown is first named by a phase that shows it: hidden until then. The head is hidden from the last phase on.
  expect([0, 1, 2].map((stage) => stageHidden(plan, stage))).toEqual([["crown"], ["crown"], ["head"]])
  expect(plan.slots).toEqual(["emissive", { asset: LOOK_GLOW_ID }])
  expect(plan.glow).toEqual([
    [{ from: 1, to: 1, ticks: 0 }, { from: 0, to: 0, ticks: 0 }],
    [{ from: 0.2, to: 1, ticks: 20 }, { from: 0, to: 0, ticks: 0 }],
    [{ from: 1, to: 1, ticks: 0 }, { from: 0, to: 1, ticks: 40 }],
  ])
  expect(plan.phaseDrops).toEqual([[{ bone: 0, name: "arm_left", ticks: 120 }], []])
  expect(bossLookPlan({ phases: [{ ...boss.phases[0]!, model: undefined }] })).toBeNull()
  // Where the arm comes off: its middle as the change's motion starts, and the same place on the model as built (blocks, its own terms; the left arm is on its left).
  const places = bossDropPlaces(plan, boss, [], design)
  expect(places.phases[0]![0]!.rest.left).toBeGreaterThan(0.3)
  expect(places.phases[0]![0]!.rest.up).toBeCloseTo(0.5, 5)
  // With abilities: the slam's drop is another bone, by ability and event.
  const withAbilities = bossLookPlan(boss, changingAbilities)!
  expect(withAbilities.bones).toEqual(["arm_left", "head", "crown", "arm_right"])
  expect(withAbilities.abilityDrops.map((drop) => [drop.ability, drop.event, drop.bone, drop.ticks])).toEqual([[0, changingAbilities[0]!.events.length - 1, 3, 100]])
  // The words of the phases and of the drop.
  expect(bossWords.phase(boss.phases[1]!, [])).toContain("模型变成：藏起「head」、显出「crown」、一张发光贴图在 2 秒里从 0% 亮到 100%")
  expect(bossWords.phase(boss.phases[0]!, [])).toContain("掉下「arm_left」（落地躺 6 秒）")
  for (const word of ["hide", "show", "glow", "drop", "emissive", "stay_seconds 1–60"]) expect(BOSS_INSTRUCTIONS).toContain(word)
  expect(BOSS_EVENT_INSTRUCTIONS).toContain('{type:"drop", at, bone, stay_seconds')
})

test("what is wrong with a boss's model changes is said against its model", () => {
  const creature = { name: "变身石魔", behavior: "hostile", abilities: [slam, burst], boss }
  const sized = () => ({ width: 128, height: 128 })
  expect(bossLookIssues(creature, design, sized)).toEqual([])
  // A bone the model lacks stops the build.
  const tail = { ...boss, phases: [{ ...boss.phases[0]!, model: { hide: ["tail"] } }] }
  expect(bossLookIssues({ ...creature, boss: tail }, design, sized).map((issue) => [issue.rule, issue.stops])).toEqual([["boss_look_bone", true]])
  // A part dropped and needed afterwards: a trail on it in an ability of the stage after, a later phase that shows it.
  const trailed = AbilitySchema.parse({ ...slam, events: [...slam.events, { type: "trail", at: 0.5, until: 0.7, bone: "arm_left", color: "#ffffff", width: 0.3, fade_ticks: 4 }] })
  const showsIt = { ...boss, phases: [boss.phases[0]!, { ...boss.phases[1]!, model: { ...boss.phases[1]!.model!, show: ["crown", "arm_left"] } }] }
  const hitbox = { core: { width: 2, height: 3 }, parts: [{ name: "护臂", bone: "arm_left", forward: 0, up: 1, left: 1, width: 1, height: 1 }] }
  const dropped = bossLookIssues({ ...creature, abilities: [trailed, burst], boss: showsIt, hitbox }, design, sized).filter((issue) => issue.rule === "boss_look_dropped")
  expect(dropped).toHaveLength(1)
  expect(dropped[0]!.text).toContain("拖尾")
  expect(dropped[0]!.text).toContain("第 2 个阶段 show「arm_left」")
  expect(dropped[0]!.text).toContain("碰撞箱部位「护臂」")
  expect(dropped[0]!.refs?.map(({ kind, id }) => [kind, id])).toEqual(expect.arrayContaining([
    ["phase", 1], ["phase", 2], ["bone", "arm_left"], ["ability", trailed.id], ["part", "护臂"],
  ]))
  // The model's own glow on a model that has none, and a glow picture of the wrong size.
  const bare = { ...design, bones: design.bones.map((bone) => ({ ...bone, cubes: bone.cubes.map((cube) => ({ ...cube, features: null })) })) }
  expect(bossLookIssues(creature, bare, sized).map((issue) => issue.rule)).toEqual(["boss_look_glow"])
  expect(bossLookIssues(creature, design, () => ({ width: 64, height: 64 }))[0]!.text).toContain("64×64")
  // Only a boss drops parts, and a boss touches at most 30 bones.
  const dropper = AbilitySchema.parse({ ...slam, events: [{ type: "drop", at: 0.7, bone: "arm_left", stay_seconds: 3 }] })
  expect(bossDropDocumentIssues({ behavior: "hostile", abilities: [dropper] }).map((issue) => issue.message)).toEqual([expect.stringContaining("只有 Boss 能掉部件")])
  expect(bossDropDocumentIssues({ behavior: "hostile", abilities: [dropper], boss })).toEqual([])
})

test("Fabric: a shake written as before is the creature's three-number call and the old runtime; the longer shake gets its own call, a cap of 8 and a mixin into the field of view", () => {
  const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: design }
  const entity = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
  const old = String(compileEntity({ ...plain, abilities: [AbilitySchema.parse({ ...slam, events: [shake] })] })[entity])
  expect(old).toContain("abilityShake(2.0f, 16.0f, 20);")
  expect(old).not.toContain("abilityShakeMore")
  const more = String(compileEntity({ ...plain, abilities: [AbilitySchema.parse({ ...slam, events: [shake, { ...shake, strength: 5, roll: 4, fov: -2.5, falloff: "none", frequency: 1.5 }] })] })[entity])
  expect(more).toContain("abilityShake(2.0f, 16.0f, 20);")
  expect(more).toContain("abilityShakeMore(5.0f, 16.0f, 20, 4.0f, -2.5f, false, 1.5f);")
  // The runtime: unchanged without the flag; with it, the longer record, both sends, the cap of 8 and two client mixins.
  const base = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", shake: true, debris: false }
  expect(compileBossRuntime(base).files).toEqual(compileBossRuntime({ ...base, shakeMore: false }).files)
  const extended = compileBossRuntime({ ...base, shakeMore: true })
  const src = "src/main/java/com/minemods/content_golem_mod"
  expect(Object.keys(extended.files).sort()).toEqual([`${src}/client/${BOSS_RUNTIME.shakeClient}.java`, `${src}/entity/${BOSS_RUNTIME.shake}.java`, `${src}/mixin/${BOSS_RUNTIME.mixin}.java`, `${src}/mixin/${BOSS_RUNTIME.view}.java`].sort())
  const client = String(extended.files[`${src}/client/${BOSS_RUNTIME.shakeClient}.java`])
  for (const word of ["CAP = 8.0", "ROLL = 10.0", "FOV = 10.0", "fovEffectScale().get()", "screenEffectScale().get()"]) expect(client).toContain(word)
  expect(String(extended.files[`${src}/mixin/${BOSS_RUNTIME.mixin}.java`])).toContain("rotation.rotateZ(roll * Mth.DEG_TO_RAD)")
  expect(String(extended.files[`${src}/mixin/${BOSS_RUNTIME.view}.java`])).toContain('@Inject(method = "getFov", at = @At("RETURN"), cancellable = true)')
  const mixins = JSON.parse(extended.patch["src/main/resources/golem_mod.mixins.json"]!('{"mixins": [], "client": []}'))
  expect(mixins.client).toEqual([BOSS_RUNTIME.mixin, BOSS_RUNTIME.view])
  // A facade target turns the view and changes the field of view through the loader's camera events: no second mixin.
  const forge = compileBossRuntime({ ...base, shakeMore: true }, genTarget("forge-1.20.1"))
  expect(Object.keys(forge.files).some((name) => name.endsWith(`${BOSS_RUNTIME.view}.java`))).toBe(false)
  const facadeClient = String(forge.files[`${src}/client/${BOSS_RUNTIME.shakeClient}.java`])
  expect(facadeClient).toContain(`StudioClientPlatform.onCameraRoll(${BOSS_RUNTIME.shakeClient}::roll);`)
  expect(facadeClient).toContain("StudioClientPlatform.onFov((fov, partialTick) -> fov + ")
})

async function lookSample(target: TargetId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-boss-look-"))
  roots.push(root)
  const project = await createTargetBossLookSample(path.join(root, "石魔变身"), target, { abilities: true })
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(path.join(root, "石魔变身"), source, TEMPLATE)
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
  return { project, source, built, names, read: (name: string) => readFile(path.join(source, name), "utf8") }
}

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: a boss whose model changes with its phases, with the longer shake, is generated and the whole tree compiles`, async () => {
    const { project, built, names, read, source } = await lookSample(target)
    const facade = target !== "fabric-1.21.1"
    const pkg = "src/main/java/com/minemods/content_stone_change"
    const creature = `creature_${project.entities[0]!.id.replaceAll("-", "")}`
    // The creature: its tables, its synced dropped parts, its drops; its renderer hides the bones and draws the glow; the glow picture beside its texture.
    const entity = await read(names.find((name) => /entity\/StudioCreature\w*\.java$/.test(name))!)
    expect(entity).toContain('private static final String[] BOSS_BONES = {"arm_left", "head", "crown"')
    expect(entity).toContain(target === "forge-1.20.1" ? "this.entityData.define(BOSS_DROPPED, 0);" : "builder.define(BOSS_DROPPED, 0);")
    expect(entity).toContain(`${BOSS_LOOK_RUNTIME.entity}.drop(this, "${creature}", BOSS_BONES[bone]`)
    expect(entity).toContain("bossDropPhase(phase);")
    const renderer = await read(names.find((name) => /client\/StudioCreatureRenderer\w*\.java$/.test(name))!)
    expect(renderer).toContain("model.getBone(bones[index]).ifPresent(bone -> bone.setHidden(off));")
    expect(renderer).toContain(`new ${BOSS_LOOK_RUNTIME.glow}<>(this,`)
    expect(renderer).not.toContain("AutoGlowingGeoLayer")
    expect(names).toContain(`src/main/resources/assets/stone_change/textures/entity/${creature}_glow_1.png`)
    expect(names).toContain(`src/main/resources/assets/stone_change/textures/entity/${creature}_glowmask.png`)
    const glow = await read(`${pkg}/client/${BOSS_LOOK_RUNTIME.glow}.java`)
    expect(glow).toContain(target === "forge-1.20.1" ? "OverlayTexture.NO_OVERLAY, level, level, level, 1.0f);" : "OverlayTexture.NO_OVERLAY, colour(level));")
    expect(built.bossFiles).toContain(`com/minemods/content_stone_change/entity/${BOSS_LOOK_RUNTIME.entity}.class`)
    // Every target: the slam's shake is the longer one and it knocks the right arm off; the burst shakes as before.
    expect(entity).toContain("abilityShakeMore(5.0f, 16.0f, 24, 4.0f, 3.0f, false, 1.5f);")
    expect(entity).toContain("abilityShake(1.5f, 12.0f, 12);")
    expect(entity).toContain(`bossDropAt(0, ${changingAbilities[0]!.events.length - 1});`)
    const client = await read(`${pkg}/client/${BOSS_RUNTIME.shakeClient}.java`)
    expect(client).toContain("CAP = 8.0")
    if (facade) {
      // Through the facade: the parts' type and the shake's channel from the common entry, the turn and the change of view through the loader's camera events.
      const content = await read(names.find((name) => /StudioContent.java$/.test(name))!)
      expect(content).toContain(`entity.${BOSS_LOOK_RUNTIME.table}.register();`)
      expect(content).toContain(`entity.${BOSS_RUNTIME.shake}.register();`)
      expect(client).toContain("StudioClientPlatform.onCameraRoll(")
      expect(names).not.toContain(`${pkg}/mixin/${BOSS_RUNTIME.view}.java`)
    } else {
      // Fabric: the field-of-view mixin; its entries and the parts' are in fabric.mod.json.
      expect(names).toContain(`${pkg}/mixin/${BOSS_RUNTIME.view}.java`)
      const metadata = JSON.parse(await read("src/main/resources/fabric.mod.json"))
      expect(metadata.entrypoints.main).toContain(`com.minemods.content_stone_change.entity.${BOSS_LOOK_RUNTIME.table}`)
      expect(metadata.entrypoints.client).toContain(`com.minemods.content_stone_change.client.${BOSS_LOOK_RUNTIME.client}`)
      expect(JSON.parse(await read("src/main/resources/stone_change.mixins.json")).client).toEqual([BOSS_RUNTIME.mixin, BOSS_RUNTIME.view])
    }
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

test("a boss that changes nothing of its model writes none of it", () => {
  const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: design }
  const still: Boss = { ...boss, phases: boss.phases.map(({ model: _model, ...phase }) => phase) }
  const files = compileEntity({ ...plain, abilities: [slam], boss: still })
  const text = Object.values(files).filter((value): value is string => typeof value === "string").join("\n")
  for (const word of ["BOSS_DROPPED", "BOSS_BONES", "bossHiddenBones", BOSS_LOOK_RUNTIME.glow]) expect(text).not.toContain(word)
  expect(shakesOf([slam, burst])).toEqual([])
})

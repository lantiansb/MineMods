import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { BOSS_SHOW_FEATURE_IDS, BOSS_SHOW_INSTRUCTIONS, BOSS_SHOW_LIMITS, bossShowAssets, bossShowClipAt, bossShowDocumentIssues, bossShowEnd, bossShowGlowAt, bossShowHiddenAt, bossShowPlan, bossShowWords } from "../src/boss-show"
import { bossShowDropPlaces, bossShowIssues, structureSize } from "../src/boss-show-model"
import { bossShowTimeline, showTimelinePicture } from "../src/boss-show-picture"
import { assembleBuildSource } from "../src/build-source"
import { BOSS_INSTRUCTIONS, bossClips, bossPlan, bossWords } from "../src/creature-boss"
import { BossSchema, creatureDocumentIssues, type Boss } from "../src/entity-runtime"
import { BOSS_SHOW_RUNTIME, compileBossShow } from "../src/fabric/boss-show"
import { BOSS_LOOK_RUNTIME } from "../src/fabric/boss-look"
import { BOSS_WEATHER } from "../src/fabric/boss-weather"
import { compileEntity } from "../src/fabric/entity"
import { genTarget } from "../src/platform/target"
import type { TargetId } from "../src/target/ids"
import { decodeRgbaPng } from "../src/png-decode"
import { createTargetBossShowSample, fourEyedDesign, showBoss } from "../script/target-boss-show-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * Boss 能力 15 (多步演出): a boss's wake-up and death as timed steps — the definition, the plan the Java is written from, the words and what an AI is told, the
 * reviewer's checks, the timeline picture, and the Java on all three targets. A boss without steps is generated exactly as before.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const design = fourEyedDesign as unknown as ModelDesign

test("the steps parse with every kind, old bosses still parse, and the document's own mistakes are refused", () => {
  expect(showBoss.intro!.steps).toHaveLength(10)
  expect(showBoss.death.steps).toHaveLength(9)
  const { steps: _intro, ...oldIntro } = showBoss.intro!
  const { steps: _death, ...oldDeath } = showBoss.death
  expect(BossSchema.safeParse({ ...showBoss, intro: oldIntro, death: oldDeath }).success).toBe(true)
  const parse = (step: Record<string, unknown>) => BossSchema.safeParse({ ...showBoss, death: { ...showBoss.death, steps: [step] } }).success
  expect(parse({ type: "place_structure", at: 1, forward: 0, left: 0, structure: { feature: "cherry", count: 3, spread: 6 } })).toBe(true)
  expect(parse({ type: "place_structure", at: 1, forward: 0, left: 0, structure: { feature: "mega_jungle_tree", count: 1, spread: 0 } })).toBe(false)
  expect(parse({ type: "place_structure", at: 1, forward: 0, left: 0, structure: { blocks: [{ block: "minecraft:no_such_block", forward: 0, up: 0, left: 0 }] } })).toBe(false)
  expect(parse({ type: "weather", at: 1, weather: { rain: false, thunder: true, dark: 0 } })).toBe(false)
  expect(parse({ type: "clip", at: 11, clip: "kneel" })).toBe(false)
  const creature = (boss: unknown) => ({ behavior: "hostile", boss: BossSchema.parse(boss) })
  const issues = bossShowDocumentIssues(
    creature({
      ...showBoss,
      death: {
        ...showBoss.death,
        steps: [
          { type: "clip", at: 0, clip: "death" },
          { type: "glow", at: 0.5 },
          { type: "glow", at: 0.6, show: ["eye_1"], hide: ["eye_1"] },
          { type: "drop", at: 1, bone: "arm_left", stay_seconds: 5 },
          { type: "drop", at: 2, bone: "arm_left", stay_seconds: 5 },
        ],
      },
    }),
  )
  expect(issues.map((issue) => issue.path.join("."))).toEqual(["boss.death.steps.0.clip", "boss.death.steps.1", "boss.death.steps.2", "boss.death.steps.4.bone"])
  // A picture the phases fade cannot be faded by a show too.
  const both = creature({ ...showBoss, phases: [{ ...showBoss.phases[0]!, model: { glow: { texture: "emissive", from: 0.5, to: 1, seconds: 1 } } }] })
  expect(bossShowDocumentIssues(both).map((issue) => issue.message).join()).toContain("已经由阶段的 model.glow 调亮调暗了")
  // The entity's own refinement says it.
  expect(creatureDocumentIssues({ behavior: "hostile", attack_damage: 4, boss: BossSchema.parse({ ...showBoss, death: { ...showBoss.death, steps: [{ type: "glow", at: 0 }] } }) }).map((issue) => issue.path.join("."))).toEqual(["boss.death.steps.0"])
})

test("the plan: bones hidden while it sleeps and shown one by one, the fight keeps the wake-up's look, the death starts from it; clips, glows, weather and the show's length", () => {
  const plan = bossShowPlan(showBoss)!
  expect(plan.bones).toEqual(["eye_1", "eye_2", "eye_3", "eye_4", "arm_right", "arm_left"])
  expect(plan.asleep).toBe(0b1111)
  expect(plan.look.intro.map((row) => [row.tick, row.mask])).toEqual([[10, 0b1110], [20, 0b1100], [30, 0b1000], [40, 0]])
  expect(plan.awake).toBe(0)
  expect(plan.look.death.map((row) => [row.tick, row.mask])).toEqual([[6, 0b010000], [16, 0b110000], [30, 0b111111]])
  expect(plan.clips).toEqual(["stomp", "kneel"])
  expect(plan.clip.intro).toEqual([{ tick: 50, clip: 0, name: "stomp" }])
  expect(plan.slots).toEqual(["emissive"])
  expect([plan.asleepGlow, plan.awakeGlow]).toEqual([[0], [1]])
  expect(plan.weather.intro.map((row) => row.tick)).toEqual([1])
  // The wake-up's last weather lasts into the first phase and the second (no phase has a weather of its own).
  expect(plan.carry).toEqual([true, true])
  expect(plan.end).toEqual({ intro: 60, death: 52 })
  // What a moment shows, as the pictures draw it.
  expect(bossShowHiddenAt(plan, "intro", -1)).toEqual(["eye_1", "eye_2", "eye_3", "eye_4"])
  expect(bossShowHiddenAt(plan, "intro", 1.2)).toEqual(["eye_3", "eye_4"])
  expect(bossShowHiddenAt(plan, "death", 2)).toEqual(["eye_1", "eye_2", "eye_3", "eye_4", "arm_right", "arm_left"])
  expect(bossShowGlowAt(plan, "intro", 1.5)[0]).toBeCloseTo(0.5, 5)
  expect(bossShowGlowAt(plan, "death", 2)[0]).toBeCloseTo(0.6, 5)
  expect(bossShowClipAt(plan, "death", 1.5)).toEqual({ clip: "kneel", time: 0.5 })
  // The show runs to its last step: a wake-up of 4 seconds whose last step is at 3 is 4 seconds; one stretched past it runs to it.
  expect(bossPlan(showBoss, []).introTicks).toBe(80)
  const late = BossSchema.parse({ ...showBoss, death: { ...showBoss.death, seconds: 1 } })
  expect(bossPlan(late, []).deathTicks).toBe(bossShowEnd(late.death.steps))
  expect(bossClips(showBoss)).toEqual(["stomp", "kneel"])
  expect(bossShowAssets(showBoss)).toEqual({ sounds: [], effects: [showBoss.intro!.steps![9]!.type === "effect" ? (showBoss.intro!.steps![9] as { effect: string }).effect : ""], particles: [(showBoss.death.steps![8] as { particle: { asset: string } }).particle.asset], glows: [] })
})

test("the words say every step in order, and what an AI is told carries the kinds and the bounds", () => {
  const words = bossShowWords(showBoss.death.steps, { bone: id => id === "arm_right" ? "右臂" : "部件" })
  expect(words.startsWith("第 0.3 秒「右臂」连同挂在它下面的部件脱手掉下来")).toBe(true)
  expect(words).toContain("第 2.6 秒在它脚下周围 6 格内长出 3 棵「樱花树（粉红的树冠）」")
  expect(bossWords.death(showBoss)).toContain("死亡演出按时间走：")
  expect(bossWords.death(showBoss)).toContain("世界允许生物改方块")
  expect(bossWords.intro(showBoss)).toContain("登场演出按时间走：第 0 秒战斗里的玩家看到不下雨")
  // A boss without steps says what it always said.
  const { steps: _steps, ...plainDeath } = showBoss.death
  expect(bossWords.death({ ...showBoss, death: plainDeath })).toBe("死的时候倒下的动作播 3 秒，期间经验分 2 次喷出")
  for (const word of ["intro.steps、death.steps", `最多 ${BOSS_SHOW_LIMITS.steps} 步`, '{type:"place_structure"', "mobGriefing", BOSS_SHOW_FEATURE_IDS.join("|"), "一只一只亮起来"]) expect(BOSS_SHOW_INSTRUCTIONS).toContain(word)
  expect(BOSS_INSTRUCTIONS).toContain(BOSS_SHOW_INSTRUCTIONS)
  // The example the instructions give parses.
  const example = JSON.parse(/ 例：(\{"intro".*\})。$/.exec(BOSS_SHOW_INSTRUCTIONS)![1]!.replace('"intro":{…,', '"intro":{"wake_distance":8,"clip":null,"sound":null,'))
  expect(BossSchema.safeParse({ ...showBoss, ...example }).success).toBe(true)
})

test("the reviewer: a step past the show, a motion or a bone the model lacks, a structure too big, a glow with no picture", () => {
  const creature = (boss: Boss) => ({ name: "四目魔像", behavior: "hostile", boss })
  expect(bossShowIssues(creature(showBoss), design)).toEqual([])
  const late = BossSchema.parse({ ...showBoss, intro: { ...showBoss.intro!, seconds: 2 } })
  const length = bossShowIssues(creature(late), design).filter((issue) => issue.rule === "boss_show_length")
  expect(length).toHaveLength(1)
  expect(length[0]!.stops).toBe(false)
  expect(length[0]!.text).toContain("会拉长到 3 秒")
  const wrong = BossSchema.parse({
    ...showBoss,
    death: {
      ...showBoss.death,
      steps: [
        { type: "clip", at: 0.5, clip: "bow" },
        { type: "glow", at: 1, show: ["tail"] },
        { type: "place_structure", at: 2, forward: 0, left: 0, structure: { feature: "cherry", count: 8, spread: 12 } },
      ],
    },
  })
  const said = bossShowIssues(creature(wrong), design)
  expect(said.map((issue) => [issue.rule, issue.stops])).toEqual([
    ["boss_show_clip", true],
    ["boss_show_bone", true],
    ["boss_show_structure", true],
  ])
  expect(structureSize({ type: "place_structure", at: 0, forward: 3, left: 4, structure: { feature: "oak", count: 2, spread: 4 } })).toEqual({ blocks: 80, reach: 11 })
  const wide = BossSchema.parse({ ...showBoss, death: { ...showBoss.death, steps: [{ type: "place_structure", at: 2, forward: 10, left: 0, structure: { feature: "oak", count: 2, spread: 8 } }] } })
  expect(bossShowIssues(creature(wide), design).map((issue) => [issue.rule, issue.stops])).toEqual([["boss_show_structure", false]])
  // A glow of the model's own parts on a model that has none, and a picture that is not there.
  const plain = { ...design, bones: design.bones.map((bone) => ({ ...bone, cubes: bone.cubes.map((cube) => ({ ...cube, features: [] })) })) } as ModelDesign
  expect(bossShowIssues(creature(showBoss), plain).map((issue) => issue.rule)).toEqual(["boss_show_glow", "boss_show_glow"])
  const pictured = BossSchema.parse({ ...showBoss, intro: { ...showBoss.intro!, steps: [{ type: "glow", at: 1, glow: { texture: { asset: "0f0f0f0f-0000-4000-8000-000000000001" }, from: 0, to: 1, seconds: 1 } }] } })
  expect(bossShowIssues(creature(pictured), design, { texture: () => null }).map((issue) => issue.rule)).toEqual(["boss_show_glow"])
  expect(bossShowIssues(creature(pictured), design, { texture: () => ({ width: 32, height: 32 }) }).map((issue) => issue.text).join()).toContain("对不齐")
  // Where its weapons come off: posed by the death motion at the drop's moment.
  const places = bossShowDropPlaces(showBoss, design)
  expect(places.death).toHaveLength(2)
  expect(places.death[0]!.rest.left).toBeLessThan(0)
  expect(places.death[1]!.rest.left).toBeGreaterThan(0)
})

test("the timeline: each show's steps at their moments, by kind, as a picture and as rows", () => {
  const timeline = bossShowTimeline(showBoss)
  expect(timeline.map((show) => [show.show, show.seconds, show.steps.length])).toEqual([
    ["intro", 4, 10],
    ["death", 3, 9],
  ])
  expect(timeline[1]!.moments.map((moment) => moment.at)).toEqual([0, 0.3, 1.5, 2.6, 3])
  const picture = showTimelinePicture(timeline[0]!)
  const image = decodeRgbaPng(picture.png)
  expect([image.width, image.height]).toEqual([720, 120])
  expect(picture.legend).toContain("发光/显隐")
})

test("a boss without steps writes none of it, byte for byte", () => {
  const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: design }
  const { steps: _intro, ...intro } = showBoss.intro!
  const { steps: _death, ...death } = showBoss.death
  const still: Boss = { ...showBoss, intro, death }
  const files = compileEntity({ ...plain, boss: still })
  const text = Object.values(files).filter((value): value is string => typeof value === "string").join("\n")
  for (const word of ["BOSS_SHOW", "bossShowStep", "bossShowHidden", BOSS_SHOW_RUNTIME.helper]) expect(text).not.toContain(word)
  // The same boss with steps, generated twice, is the same.
  expect(JSON.stringify(compileEntity({ ...plain, boss: showBoss }))).toBe(JSON.stringify(compileEntity({ ...plain, boss: showBoss })))
})

test("the helper asks the loader whether the mob may change blocks on a facade target and the game rule on Fabric", () => {
  const base = { modId: "four_eyes", packageName: "com.minemods.content_four_eyes" }
  const fabric = Object.values(compileBossShow(base).files)[0]!
  expect(fabric).toContain("GameRules.RULE_MOBGRIEFING")
  const forge = Object.values(compileBossShow(base, genTarget("forge-1.20.1")).files)[0]!
  expect(forge).toContain("StudioPlatform.mobGriefing(boss)")
  expect(forge).not.toContain("GameRules")
})

async function showSample(target: TargetId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-boss-show-"))
  roots.push(root)
  const project = await createTargetBossShowSample(path.join(root, "四目演出"), target)
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(path.join(root, "四目演出"), source, TEMPLATE)
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
  return { project, source, built, names, read: (name: string) => readFile(path.join(source, name), "utf8") }
}

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: a boss whose wake-up and death are timed steps is generated and the whole tree compiles`, async () => {
    const { project, built, names, read, source } = await showSample(target)
    const pkg = "src/main/java/com/minemods/content_four_eyes"
    const creature = `creature_${project.entities[0]!.id.replaceAll("-", "")}`
    const entity = await read(names.find((name) => /entity\/StudioCreature\w*\.java$/.test(name))!)
    expect(entity).toContain(target === "forge-1.20.1" ? "this.entityData.define(BOSS_SHOW_AT, Long.MIN_VALUE);" : "builder.define(BOSS_SHOW_AT, Long.MIN_VALUE);")
    expect(entity).toContain('private static final String[] BOSS_SHOW_BONES = {"eye_1", "eye_2", "eye_3", "eye_4", "arm_right", "arm_left"};')
    expect(entity).toContain("bossShowIntro(BOSS_WAKE_TICKS - bossTimer);")
    expect(entity).toContain("bossShowStep(2, deathTime);")
    expect(entity).toContain(`${BOSS_LOOK_RUNTIME.entity}.drop(this, "${creature}", "arm_right", 400,`)
    expect(entity).toContain(`${BOSS_SHOW_RUNTIME.helper}.feature(this, "minecraft:cherry", 3, 6.0, 0.0, 0.0, true)`)
    expect(entity).toContain(`${BOSS_WEATHER.server}.fight(this, bossBar.getPlayers(), bossShowWeather());`)
    expect(entity).toContain('RawAnimation.begin().thenPlayAndHold("animation.' + creature + '.kneel")')
    expect(entity).toContain("isDeadOrDying() && bossShowClipStep() < 0 ? state.setAndContinue(DEATH)")
    // The death is held until its last step (2.6 s), past its 3 seconds it is not.
    expect(entity).toContain("private static final int BOSS_DEATH_TICKS = 60;")
    const renderer = await read(names.find((name) => /client\/StudioCreatureRenderer\w*\.java$/.test(name))!)
    expect(renderer).toContain("creature.bossShowHidden()")
    expect(renderer).toContain("creature.bossShowGlow(slot, partialTick)")
    expect(renderer).not.toContain("AutoGlowingGeoLayer")
    expect(names).toContain(`${pkg}/entity/${BOSS_SHOW_RUNTIME.helper}.java`)
    expect(built.bossFiles).toContain(`com/minemods/content_four_eyes/entity/${BOSS_SHOW_RUNTIME.helper}.class`)
    expect(names).toContain(`${pkg}/entity/${BOSS_LOOK_RUNTIME.entity}.java`)
    expect(names).toContain(`${pkg}/entity/${BOSS_WEATHER.server}.java`)
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

test("a death shown by its steps' motions alone is not tipped over: the vanilla turn on its side is off as it is for a model's own death motion", () => {
  // A model with no motion called "death" whose death show kneels: GeckoLib's renderer turned the whole body 90° onto its side over the first second, so the kneel lay flat.
  const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const }
  const renderer = (model: ModelDesign, boss: Boss) => Object.entries(compileEntity({ ...plain, model, boss })).find(([name]) => /client\/StudioCreatureRenderer\w*\.java$/.test(name))![1] as string
  const noDeath = { ...design, animations: design.animations.filter((clip) => clip.name !== "death") }
  expect(noDeath.animations.length).toBe(design.animations.length - 1)
  expect(renderer(noDeath, showBoss)).toContain("@Override protected float getDeathMaxRotation(StudioCreature creature) { return 0f; }")
  expect(renderer(noDeath, showBoss)).toContain("Its death show's motions (Boss 能力 15) are what show")
  // With the model's own death motion it was already off (the words as they were); with neither, the game's own tip-over stays.
  expect(renderer(design, showBoss)).toContain("// The model's own death motion is what shows; the vanilla tip-over would be added on top of it.")
  const { steps: _death, ...death } = showBoss.death
  expect(renderer(noDeath, { ...showBoss, death })).not.toContain("getDeathMaxRotation")
})

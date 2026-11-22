import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { EPIC_LIMITS, ABILITY_LIMITS, COMBO_LIMITS } from "../src/ability-words"
import { TACTICS_INSTRUCTIONS, TACTICS_LIMITS, betweenStages, branchWords, leapPlan, leapWords, stagePlan, stageWords, tacticsWords, trackWords } from "../src/ability-tactics"
import { assembleBuildSource } from "../src/build-source"
import { abilityClipAt, abilityHitShapes, abilityWords, bonePlace, comboWords, hitAnchor, hitLines } from "../src/creature-abilities"
import { CREATURE_LIFE_INSTRUCTIONS } from "../src/creature-life"
import { AbilitySchema, ComboSchema, EntitySchema, type Ability } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { bossMasks } from "../src/creature-boss"
import { tierLimitIssues } from "../src/creature-tier"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign } from "../script/data-gameplay-sample"
import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import { bossOfAll, charge, createTargetTacticsSample, gatherSlam, leapSlam, lockedCharge, reaper, sweep, tactics, thrust } from "../script/target-tactics-sample"
import { ramAbilities } from "../script/target-dash-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * 第 3 步 (Boss AI 与出招): tracking until a moment at a speed, a leap and a leading aim, stages with a loop that ends on a condition, branching combos, how a creature
 * moves and reacts between abilities, and the epic tier's larger limits. The schema and its plain-words refusals, what the external AI is told, the words, the Java
 * (and that a creature without any of it is the Java it always was), and a boss with all of it compiled on all three targets.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const refused = (ability: unknown) => AbilitySchema.safeParse(ability).error?.issues.map((issue) => issue.message).join(" ") ?? ""
const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 300, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const entityPath = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const java = (more: Record<string, unknown>) => String(compileEntity({ ...plain, ...more } as never)[entityPath])
const leapOf = (ability: Ability) => ability.moves.find((move) => "type" in move && move.type === "leap") as Extract<Ability["moves"][number], { type: "leap" }>

test("the sample parses as written, and its plans are the ticks the Java acts on", () => {
  expect(AbilitySchema.parse(charge)).toEqual(charge)
  expect(leapPlan(leapSlam)).toEqual({ index: 0, leap: leapOf(leapSlam), start: 6, ticks: 14 })
  expect(stagePlan(charge).map((stage) => [stage.kind, stage.from, stage.to, stage.clip])).toEqual([
    ["windup", 0, 12, null],
    ["loop", 12, 44, "burst"],
    ["strike", 44, 50, "slam"],
    ["recover", 50, 60, "wave"],
  ])
  expect(betweenStages(tactics, bossOfAll.phases).map((stage) => stage.style)).toEqual(["circle", "close_in"])
  expect(betweenStages(null, []).map((stage) => stage.style)).toEqual(["chase"])
})

test("what tracking, a leap and stages may not be is said in plain words", () => {
  expect(refused({ ...sweep, facing: "lock", track_until: 0.3 })).toContain('只有一直转向目标的招式（facing 写 "track"）才写 track_until')
  expect(refused({ ...sweep, track_until: 2 })).toContain("不能比招式全长（length）还晚")
  expect(refused({ ...sweep, facing: "lock", turn_speed: 200 })).toContain("才写转身速度（turn_speed）")
  expect(refused({ ...sweep, turn_speed: TACTICS_LIMITS.turn.max + 1 })).not.toBe("")
  const leap = (change: Record<string, unknown>) => refused({ ...leapSlam, moves: [{ ...leapOf(leapSlam), ...change }] })
  expect(leap({})).toBe("")
  expect(leap({ land: 1.7 })).toContain("落地的时刻（land）不能比招式全长（length）还晚")
  expect(leap({ land: 0.4 })).toContain(`至少 ${TACTICS_LIMITS.leap.ticks / 20} 秒`)
  expect(leap({ short: 20 })).not.toBe("")
  expect(leap({ short: 8, max_distance: 6 })).toContain("要比最远能跳的距离（max_distance）小")
  expect(refused({ ...leapSlam, moves: [leapOf(leapSlam), leapOf(leapSlam)] })).toContain("最多 1 次跳跃")
  expect(refused({ ...charge, moves: [...charge.moves, { type: "leap", at: 0.6, land: 1.2, height: 2, aim: "target", max_distance: 8 }] })).toContain("不能既冲刺（dash）又跳跃（leap）")
  const stages = (change: (list: Ability["stages"] & object) => unknown) => refused({ ...charge, stages: change([...charge.stages!]) })
  expect(stages((list) => list)).toBe("")
  expect(stages((list) => [list[0], { ...list[1]!, end: undefined }, list[2], list[3]])).toContain("至少写一样")
  expect(stages((list) => [list[0], list[1], { ...list[2]!, clip: undefined }, list[3]])).toContain("后面接着的那一段要写自己的动作（clip）")
  expect(stages((list) => [list[0], list[1], list[2], { ...list[3]!, until: 2.9 }])).toContain("最后一段要一直到招式结束")
  expect(stages((list) => [{ ...list[0]!, clip: "roar" }, list[1], list[2], list[3]])).toContain("第一段播的就是招式自己的动作")
  expect(stages((list) => [list[0], { ...list[2]!, until: 0.5 }, list[1], list[3]])).toContain("每一段结束的时刻（until）要比上一段晚")
  expect(stages((list) => [list[0], list[1], { ...list[2]!, kind: "loop", end: { wall: true } }, list[3]])).toContain("最多一段循环")
  expect(stages((list) => [list[0], list[1], { ...list[2]!, end: { wall: true } }, list[3]])).toContain('只有循环段（kind:"loop"）写 end')
  // A predicted dash still waits for the end of getting ready.
  expect(refused({ ...charge, moves: [{ ...charge.moves[0]!, from: 0.2 }] })).toContain("预判的冲刺（aim 写的是 predicted）")
})

test("a combo's branches and a creature's tactics are checked against what it has", () => {
  expect(ComboSchema.parse(reaper)).toEqual(reaper)
  const creature = (more: Record<string, unknown>) => EntitySchema.safeParse({ id: "00000000-0000-4000-8000-000000000001", name: "裂地将", description: "", health: 300, speed: 0.25, attack_damage: 6, behavior: "hostile", model_asset_id: null, abilities: [charge, leapSlam, sweep, thrust], ...more }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  expect(creature({ combos: [reaper], tactics, boss: bossOfAll })).toBe("")
  expect(creature({ combos: [{ ...reaper, branches: [{ after: 1, to: 0 }] }] })).toContain("分支只能往后跳")
  expect(creature({ combos: [{ ...reaper, branches: [{ after: 5, to: null }] }] })).toContain("没有第 5 步")
  expect(creature({ combos: [{ ...reaper, branches: [{ after: 0, at: 3, to: 1 }] }] })).toContain("不能比那一招的全长（0.5 秒）还晚")
  expect(creature({ combos: [{ ...reaper, branches: [{ after: 0, min_distance: 5, max_distance: 4, to: 1 }] }] })).toContain("最远距离（max_distance）要比最近距离（min_distance）大")
  expect(creature({ tactics: { ...tactics, kited: { distance: 12, seconds: 3, use: ["fly"] } } })).toContain("被放风筝时要用的 fly")
  expect(creature({ tactics: { ...tactics, hugged: { distance: 14, seconds: 2 } } })).toContain("被贴身的距离（hugged.distance）要比被放风筝的距离（kited.distance）近")
  expect(creature({ tactics, stationary: { reason: "炮台" } })).toContain("故意不走动的生物（stationary）出招之间不走动")
  expect(creature({ behavior: "passive", abilities: [], tactics })).toContain("只给会出招的敌对生物写")
})

test("the epic tier carries more abilities, hits and combos; every other tier is held to the old numbers", () => {
  expect(EPIC_LIMITS).toEqual({ abilities: 24, hits: 10, combos: 8 })
  expect(ABILITY_LIMITS.abilities).toBe(16)
  const many = Array.from({ length: EPIC_LIMITS.abilities }, (_, index) => ({ ...sweep, id: `a${index}` }))
  const hits = Array.from({ length: EPIC_LIMITS.hits }, () => sweep.hits[0]!)
  const combos = Array.from({ length: EPIC_LIMITS.combos }, (_, index) => ({ ...reaper, id: `c${index}`, steps: ["a0", "a1"], branches: undefined }))
  const base = { id: "00000000-0000-4000-8000-000000000001", name: "史诗", description: "", health: 300, speed: 0.25, attack_damage: 6, behavior: "hostile", model_asset_id: null }
  const epic = EntitySchema.parse({ ...base, abilities: [{ ...many[0]!, hits }, ...many.slice(1)], combos })
  expect(EntitySchema.safeParse({ ...base, abilities: [...many, { ...sweep, id: "over" }] }).success).toBe(false)
  expect(AbilitySchema.safeParse({ ...sweep, hits: [...hits, sweep.hits[0]!] }).success).toBe(false)
  expect(tierLimitIssues("epic", epic)).toEqual([])
  const said = tierLimitIssues("boss", epic).join(" ")
  expect(said).toContain(`招式最多 ${ABILITY_LIMITS.abilities} 个`)
  expect(said).toContain(`出手最多 ${ABILITY_LIMITS.hits} 次`)
  expect(said).toContain(`连招最多 ${COMBO_LIMITS.combos} 个`)
  expect(tierLimitIssues("standard", { abilities: [charge], combos: [] })).toEqual([])
  // 24 abilities and 8 combos are 32 choices: the last one's bit is the sign bit of the phase mask, which Java's `&` reads as any other.
  const masks = bossMasks({ phases: [{ below: 0.5, clip: null, seconds: 1, bar_color: null, speed: 1, damage: 1, abilities: ["c7"] }] }, [...many, ...combos])
  expect(masks[1]).toBe(1 << 31)
  expect(masks[0]).toBe(~(1 << 31))
})

test("a weighted between-move plan names its rhythm, weights and minimum turning interval", () => {
  const mix = { every_ticks: 40, choices: [{ style: "circle" as const, weight: 3 }, { style: "close_in" as const, weight: 1 }] }
  const between = { style: "circle" as const, distance: 6, pause: 1, mix, side_ticks: 160, path_ticks: 12, stand_distance: 2 }
  expect(tacticsWords({ between })).toContain("每 40 刻")
  expect(tacticsWords({ between })).toContain("转圈 3 份")
  expect(tacticsWords({ between })).toContain("至少保持 160 刻")
  expect(tacticsWords({ between })).toContain("2 格内时站定")
})

test("the external AI is told every piece with three worked examples, and the words say what the data says", () => {
  expect(CREATURE_LIFE_INSTRUCTIONS).toContain(TACTICS_INSTRUCTIONS)
  for (const words of ["track_until", "turn_speed", '{type:"leap", at, land, height, aim, max_distance, short}', '"predicted"', "stages", "loop", "branches", "tactics：{between, kited, hugged, enrage}", "例一 蓄力冲锋", "例二 跳劈", "例三 按距离拐弯的连招", `招式最多 ${EPIC_LIMITS.abilities} 个`]) expect(TACTICS_INSTRUCTIONS).toContain(words)
  // Every example in the text parses.
  const examples = [...TACTICS_INSTRUCTIONS.matchAll(/例[一二三][^：]*：(\{.*?\})(?=。| ——|——)/g)].map((match) => JSON.parse(match[1]!))
  expect(examples).toHaveLength(3)
  expect(AbilitySchema.safeParse(examples[0]).success).toBe(true)
  expect(AbilitySchema.safeParse(examples[1]).success).toBe(true)
  expect(ComboSchema.safeParse(examples[2]).success).toBe(true)
  expect(trackWords(charge)).toBe("一直转向目标，到第 0.55 秒才定住朝向（每秒最多转 240°）")
  expect(leapWords(leapSlam)).toBe("第 0.3 秒跳起，扑向目标所在的地方（最远 16 格），弧顶比直线高 3 格，第 1 秒落地")
  expect(stageWords(charge)).toBe("分段：蓄力到 0.6 秒 → 循环到 2.2 秒（撞墙、打中了人就提前结束，播 burst） → 出手到 2.5 秒（播 slam） → 收招到 3 秒（播 wave）")
  expect(abilityWords.summary(charge)).toContain("朝目标冲到时会在的地方预判")
  expect(abilityWords.summary(leapSlam)).toContain("第 1 秒落地")
  expect(branchWords(reaper, id => id === "sweep" ? "横扫" : "跳劈")).toContain("第 1 步「横扫」收完：目标在 4 格以外 → 接第 2 步「跳劈」")
  expect(comboWords.summary(reaper, [charge, leapSlam, sweep, thrust])).toContain("分支：")
  expect(tacticsWords(tactics)).toBe("出招之间绕着目标转圈（5 格），每招之后歇 0.5 秒；目标在 12 格外待了 3 秒（放风筝）就用「leap_slam」或「charge」；目标贴在 1.5 格以内 2 秒就往后跳开；血量低于 30% 暴怒：走得快 1.3 倍、招式伤害 1.5 倍、冷却 0.6 倍")
})

test("a hit that lands with a leap is drawn where it comes down, with the leap's arrow, and said under its picture", () => {
  // The sample is plain data (its vectors are number[]): read as the model it is, so it has the model's types.
  const golem = ModelDesignSchema.parse(fightingGolemDesign)
  const shapes = abilityHitShapes(leapSlam, golem)!
  const plain = abilityHitShapes({ ...leapSlam, moves: [] }, golem)!
  // The arrow and the ball once more at the end of it.
  expect(shapes[0]!.faces.length).toBeGreaterThan(plain[0]!.faces.length * 2)
  // The middle of its window is 10 blocks; it leaps all of that (no `short`).
  expect(Math.min(...shapes[0]!.faces.flat().map((point) => point[2]))).toBeLessThan(-9.5 * 16)
  expect(hitLines(leapSlam, shapes[0]!).join("")).toContain("图上地上的箭头是它跳过去的方向和距离（目标站在出招距离的中间时，10 格）")
  expect(hitLines(charge, abilityHitShapes(charge, golem)![1]!).join("")).not.toContain("跳过去")
})

test("a creature without any of it is the Java it always was, and each piece is written only where it is used", () => {
  const [ram, vortex] = ramAbilities as [Ability, Ability]
  const old = java({ abilities: [ram, vortex, sweep], combos: [{ ...reaper, steps: ["sweep", "ram"], branches: undefined }] })
  for (const name of ["ABILITY_TRACK_UNTIL", "abilityLead", "abilityLeap", "abilityStage", "abilityLoopCheck", "COMBO_BRANCHES", "tactics", "abilityLanded", "abilityDashBumped"]) expect(old).not.toContain(name)
  expect(old).toContain("if (abilityTick < ABILITY_WINDUP[abilityIndex] && ABILITY_TRACKS[abilityIndex]) abilityAim(abilityTarget, true);")
  expect(old).toContain("abilityDashStart(20, 1.0, 20.0, true, 8);")
  const all = java({ abilities: [charge, leapSlam, sweep, thrust], combos: [reaper], tactics, boss: bossOfAll })
  expect(all).toContain("if (abilityTick < ABILITY_TRACK_UNTIL[abilityIndex] && ABILITY_TRACKS[abilityIndex]) abilityAim(abilityTarget, true);")
  expect(all).toContain("private static final int[] ABILITY_TRACK_UNTIL = {11, 6, 5, 6};")
  expect(all).toContain("private static final float[] ABILITY_TURN = {12.0f, 30.0f, 30.0f, 30.0f};")
  expect(all).toContain("abilityDashStart(32, 0.75, 22.0, true, 12, true);")
  expect(all).toContain("abilityLeapStart(14, 3.0, 16.0, 0.0, false);")
  expect(all).toContain('RawAnimation.begin().thenLoop("animation.creature.burst"),')
  expect(all).toContain("abilityStageClip(4);")
  expect(all).toContain("case 0 -> abilityTick >= 12 && abilityTick < 44 && ((horizontalCollision || abilityDashBumped) || abilityLanded) ? 44 : -1;")
  expect(all).toContain("private static final double[][] COMBO_BRANCHES = {{0, 0, -1, 4.0, 1024.0, -1, 1}, {0, 0, -1, 0.0, 4.0, -1, 2}, {0, 1, -1, 0.0, 1024.0, -1, -1}, {0, 2, 12, 0.0, 1024.0, 0, -1}};")
  expect(all).toContain("private static final int[] TACTICS_STYLE = {1, 3};")
  expect(all).toContain("private static final int TACTICS_KITE_MASK = 3;")
  expect(all).toContain(" * tacticsDamageScale()")
  expect(all).toContain("if (tacticsMove(target)) return;")
  expect(java({ abilities: [sweep], tactics, runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null } })).toContain("|| startAbility(target) || tacticsMove(target)) return;")
  expect(all).toContain("abilityReadyAt[abilityIndex] = tickCount + tacticsWait(ABILITY_COOLDOWN[abilityIndex]);")
  // A creature with only a style moves by it; one with only an enrage keeps its own walk.
  expect(java({ abilities: [sweep], tactics: { enrage: tactics.enrage } })).not.toContain("tacticsMove(")
})

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: a boss with all of it, and the check's creatures, are assembled by Studio's own build and compile against the real class path`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-tactics-tree-"))
    roots.push(root)
    await createTargetTacticsSample(path.join(root, "裂地关"), target)
    const source = path.join(root, "source")
    await mkdir(source)
    await assembleBuildSource(path.join(root, "裂地关"), source, TEMPLATE)
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".java")).map((entry) => path.join(entry.parentPath, entry.name))
    const creatures = await Promise.all(names.filter((name) => /StudioCreatureEntity\d_\w+\.java$/.test(name) && !/Renderer|Model/.test(name)).map((name) => readFile(name, "utf8")))
    expect(creatures.some((text) => text.includes("tacticsMove(target)") && text.includes("COMBO_BRANCHES") && text.includes("abilityLeapStart") && text.includes("abilityLoopCheck"))).toBe(true)
    expect(creatures.every((text) => !/^import net\.(minecraftforge|neoforged|fabricmc)\./m.test(text))).toBe(true)
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

test.skipIf(!hasTargetJavac(CLASSPATH["fabric-1.21.1"]))("on Fabric a flier and a stationary creature with tracking and stages compile too", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-tactics-"))
  roots.push(root)
  const { writeFile } = await import("node:fs/promises")
  const { dragonDesign, dragonFlight } = await import("./giant-flier")
  const shapes = [
    { classSuffix: "F", model: dragonDesign, abilities: [{ ...sweep, clip: "attack", where: "ground" }, { ...leapSlam, clip: "sweep", where: "ground" }], flight: dragonFlight, tactics },
    { classSuffix: "A", model: dragonDesign, abilities: [{ ...sweep, clip: "attack", where: "air", dive: true, turn_speed: 120 }], flight: dragonFlight, steady: { preset: "huge" } },
    { classSuffix: "S", abilities: [{ ...sweep, turn_speed: 120, track_until: 0.45 }, lockedCharge], stationary: { reason: "炮台" }, tactics: { enrage: tactics.enrage } },
  ]
  for (const shape of shapes) {
    const files = compileEntity({ ...plain, ...shape } as never)
    const entity = String(files[`src/main/java/com/minemods/content_golem_mod/entity/StudioCreature${shape.classSuffix}.java`])
    if (shape.steady) {
      expect(entity).toContain("abilityTurnToward(want);")
      expect(entity).toContain("if (flat > 0.05) yaw = flightBodyYaw(yaw,")
      expect(entity).toContain("ABILITY_TURN = {6.0f}")
    }
    await writeFile(path.join(root, `StudioCreature${shape.classSuffix}.java`), entity)
  }
  // What the classes lean on beside themselves: the boss runtime's shake.
  const { compileBossRuntime } = await import("../src/fabric/boss-runtime")
  for (const [name, text] of Object.entries(compileBossRuntime({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", shake: true, debris: false }).files)) await writeFile(path.join(root, path.basename(name)), String(text))
  const compiled = await targetJavac(CLASSPATH["fabric-1.21.1"], root)
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 180000)

test("with a layered ability every slot of ABILITY_CLIPS has its walk entry: a stage's own motion walks as its ability does", () => {
  // The synced number names a stage's slot (after the abilities' own) while that stage plays, and every player's game reads ABILITY_WALKS by it: one entry per ability alone was out of bounds there.
  const layered = { ...fightingGolemDesign, animations: fightingGolemDesign.animations.map((clip) => (clip.name === "roar" ? { ...clip, layered: true } : clip)) }
  const text = java({ model: layered, abilities: [charge, sweep] })
  const clips = /ABILITY_CLIPS = \{\n([\s\S]*?)\n    \};/.exec(text)![1]!.split("\n").length
  const walks = /ABILITY_WALKS = \{([^}]*)\}/.exec(text)![1]!.split(", ")
  expect(clips).toBe(5)
  expect(walks).toEqual(["true", "false", "true", "true", "true"])
  expect(text).toContain("!ABILITY_WALKS[(getEntityData().get(ABILITY) & 255) - 1]")
})

test("an enrage with no style between abilities speeds its plain chase too: the abilities' own goal and a runtime's movement", () => {
  const enraged = java({ abilities: [sweep], tactics: { enrage: tactics.enrage } })
  expect(enraged).toContain("private double tacticsPace() { return tacticsEnraged() ? TACTICS_ENRAGE_SPEED : 1.0; }")
  expect(enraged).toContain("getNavigation().moveTo(target, 1.2 * tacticsPace());")
  expect(enraged).not.toContain("getNavigation().moveTo(target, 1.2);")
  const runtime = (movement: string, more: Record<string, unknown>) => java({ abilities: [sweep], runtime: { spawn: null, explosion: null, movement, armor: 0, charging_armor: 0, texture_asset_id: null }, ...more })
  expect(runtime("burst", { tactics: { enrage: tactics.enrage } })).toContain("getNavigation().moveTo(target, (tickCount % 40 < 12 ? 1.8 : 0.75) * tacticsPace());")
  expect(runtime("direct", { tactics: { enrage: tactics.enrage } })).toContain("getNavigation().moveTo(target, 1.0 * tacticsPace());")
  // A style reads the same pace; without an enrage every speed is what it was, to the byte.
  expect(java({ abilities: [sweep], tactics })).toContain("double speed = tacticsPace();")
  expect(runtime("burst", {})).toContain("getNavigation().moveTo(target, tickCount % 40 < 12 ? 1.8 : 0.75);")
  expect(java({ abilities: [sweep] })).toContain("getNavigation().moveTo(target, 1.2);")
})

test("a leap comes down on the ground where it lands, not at its target's height", () => {
  // Put short of its target, held to its reach or led ahead, the landing need not be where they stand: a target on a pillar 3 blocks up left it landing 3 blocks up in the air.
  const text = java({ abilities: [{ ...leapSlam, moves: [{ ...leapOf(leapSlam), short: 3 }] }] })
  expect(text).toContain("abilityLeapToY = abilityLeapGround(abilityLeapToX, abilityLeapToZ, target.getY());")
  expect(text).not.toContain("abilityLeapToY = target.getY();")
  const ground = /private double abilityLeapGround\(double x, double z, double prefer\) \{[\s\S]*?\n    \}\n/.exec(text)![0]
  expect(ground).toContain(`double high = Math.max(prefer, getY()) + ${TACTICS_LIMITS.leap.ground.up}.0;`)
  expect(ground).toContain(`double low = Math.min(prefer, getY()) - ${TACTICS_LIMITS.leap.ground.down}.0;`)
  // Its whole box must fit where it is looked for, and is let down by its own collision onto what is under it there.
  expect(ground).toContain("if (!level().noCollision(this, at)) continue;")
  expect(ground).toContain("collideBoundingBox(this, new net.minecraft.world.phys.Vec3(0.0, -depth, 0.0), at, level(), List.of());")
  expect(ground).toContain("return prefer;")
})

test("a loop that ends early still begins the warning of a blow after it that begins inside it: the slam's places are decided before it lands", () => {
  // Loop 12–44 ending within 3 blocks, a slam at 45 warned 10 ticks before (35). Ending at tick 20 used to go on from 44: tick 35 never ran, abilityPlaces[0] stayed null and the slam threw a NullPointerException.
  expect(stagePlan(gatherSlam).map((stage) => [stage.from, stage.to])).toEqual([[0, 12], [12, 44], [44, 50], [50, 60]])
  const text = java({ abilities: [gatherSlam, sweep] })
  const loop = /case 0 -> abilityTick >= 12 && abilityTick < 44 && \(distanceTo\(abilityTarget\) <= 3\.0\) \? (.*) : -1;/.exec(text)!
  expect(loop[1]).toBe("(abilityTick < 35 ? 35 : 44)")
  // Wherever the loop ends, the tick its warning begins on still runs: before the end, or as the first tick it goes on from.
  const goesOn = (ended: number) => (ended < 35 ? 35 : 44)
  for (let ended = 12; ended < 44; ended++) expect(ended >= 35 || goesOn(ended) <= 35).toBe(true)
  const step = /private void abilityStep0\(int tick\) \{([\s\S]*?)\n    \}\n/.exec(text)![1]!
  // On tick 35 the warning (its places decided) begins whatever happened; the slam on 45 reads those places.
  const warnAt = /if \(tick == 35\) \{\n([\s\S]*?)\n        \}/.exec(step)![1]!
  expect(warnAt.split("\n")[0]).toBe("            abilityPlaces[0] = abilityPlaceSelf();")
  expect(warnAt).toContain("abilityWarn(0, ")
  expect(warnAt).not.toContain("abilityQuiet")
  expect(/if \(tick == 45\) \{[\s\S]*?abilityVictims\(true, [\d.]+, abilityPlaces\[0\]\)/.test(step)).toBe(true)
  // The roar at tick 38 is the rest of the loop: held back while the loop has ended.
  expect(step).toContain("        if (tick == 38) {\n            if (!abilityQuiet(tick)) {\n                level().playSound(")
  expect(text).toContain("private boolean abilityQuiet(int tick) { return abilityQuietSerial == abilitySerial && tick >= abilityQuietFrom && tick < abilityQuietUntil; }")
  expect(text).toContain("abilityQuietUntil = switch (abilityIndex) {\n            case 0 -> 44;\n            default -> to;\n        };\n        abilityQuietFrom = to;\n        abilityQuietSerial = abilitySerial;\n        abilityTick = to - 1;")
  expect(text).toContain("if (abilityQuiet(abilityTick)) return;")
  // A loop with nothing after it warned from inside it is what it was.
  const plainLoop = java({ abilities: [charge] })
  expect(plainLoop).toContain("case 0 -> abilityTick >= 12 && abilityTick < 44 && ((horizontalCollision || abilityDashBumped) || abilityLanded) ? 44 : -1;")
  expect(plainLoop).not.toContain("abilityQuiet")
})

test("稳重跳扑先用受限朝向定落点，再在同一处画预警", () => {
  const text = java({
    steady: { preset: "colossal" },
    abilities: [{ ...leapSlam, hits: [{ ...leapSlam.hits[0], warn: { seconds: 0.9, look: "ring", color: "red" } }] }],
  })
  expect(text).toContain("abilityLeapToX = getX() - Mth.sin(launch) * go;")
  expect(text).toContain("abilityLeapToZ = getZ() + Mth.cos(launch) * go;")
  const step = /private void abilityStep0\(int tick\) \{([\s\S]*?)\n    \}/.exec(text)![1]!
  expect(step).toMatch(/if \(tick == 6\) \{[\s\S]*?abilityLeapStart\([\s\S]*?abilityPlaces\[0\] = .*new double\[\] \{abilityLeapToX, abilityLeapToY, abilityLeapToZ\}/)
  expect(step).toMatch(/abilityWarn\([^\n]+, 14\);/)
})

test("a hit that names a bone counts from where that bone is in the motion its stage plays, from the stage's start", () => {
  // 蓄力冲锋: roar from 0, burst looped from tick 12, slam from 44, wave from 50. A hit at 2.25 s (tick 45) from the right arm was counted from roar held at its end (0.8 s), the slam it swings in ~2 blocks away.
  const golem = fightingGolemDesign as unknown as ModelDesign
  const clip = (name: string) => golem.animations.find((value) => value.name === name)!
  const at = (seconds: number) => ((value) => value && [value.clip.name, Number(value.time.toFixed(4))])(abilityClipAt(charge, golem, seconds))
  expect(at(0.3)).toEqual(["roar", 0.3])
  expect(at(0.7)).toEqual(["burst", 0.1])
  expect(at(2.0)).toEqual(["burst", 1.4])
  expect(at(2.25)).toEqual(["slam", 0.05])
  expect(at(2.8)).toEqual(["wave", 0.3])
  // The ability's own clip is held at its last moment past its end; a loop's goes round.
  const short = { ...golem, animations: golem.animations.map((value) => (value.name === "burst" ? { ...value, length: 0.5 } : value)) }
  expect(abilityClipAt({ ...charge, stages: [charge.stages![0]!, { ...charge.stages![1]!, until: 3 }] }, golem, 0.55)).toMatchObject({ clip: { name: "roar" }, time: 0.55 })
  expect(Number(abilityClipAt(charge, short, 2.0)!.time.toFixed(4))).toBe(0.4)
  expect(abilityClipAt({ ...charge, stages: undefined }, golem, 2.25)).toMatchObject({ clip: { name: "roar" }, time: 0.8 })
  const armed = { ...charge, hits: charge.hits.map((hit, index) => (index === 1 ? { ...hit, bone: "arm_right" } : hit)) } as Ability
  const anchor = hitAnchor(armed, 1, golem)!
  expect(anchor).toEqual(bonePlace(golem, "arm_right", clip("slam"), 0.05)!)
  expect(anchor).not.toEqual(bonePlace(golem, "arm_right", clip("roar"), 0.8)!)
  // Without stages a hit counts from the ability's own clip as it always did.
  expect(hitAnchor({ ...armed, stages: undefined }, 1, golem)).toEqual(bonePlace(golem, "arm_right", clip("roar"), 0.8))
})

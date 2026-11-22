import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PARRY_INSTRUCTIONS, PARRY_LIMITS, parryDocumentIssues, parryReview, parryShare, parryTimeline, parryTimelineWords } from "../src/ability-parry"
import { PARRY_COLOURS, parryTimelinePicture } from "../src/ability-parry-picture"
import { assembleBuildSource } from "../src/build-source"
import { ABILITY_INSTRUCTIONS, ABILITY_SUMMARY, abilityIssues, abilityPlan, abilityWords } from "../src/creature-abilities"
import { AbilitySchema, BossSchema, creatureDocumentIssues, type Ability } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { DISARM, compileDisarm } from "../src/fabric/ability-parry"
import { compileBossRuntime } from "../src/fabric/boss-runtime"
import { decodeRgbaPng } from "../src/png-decode"
import { genTarget } from "../src/platform/target"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign } from "../script/data-gameplay-sample"
import { bossParryAbility, createTargetParrySample, parryAbility, slamAbility } from "../script/target-parry-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * Boss 能力 14 (夺兵): an ability a blow starts (`on_hurt`: by chance, by kind of blow, after a wait, parrying the blow or not) and the disarm it leaves on the player who
 * struck. The definition, what the external AI is told, the time line and its picture, the reviewer, and the Java on all three targets.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const refused = (ability: unknown) => AbilitySchema.safeParse(ability).error?.issues.map((issue) => issue.message).join(" ") ?? ""
const withHurt = (change: Record<string, unknown>) => ({ ...parryAbility, on_hurt: { ...parryAbility.on_hurt!, ...change } })
const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const entityPath = (suffix = "") => `src/main/java/com/minemods/content_golem_mod/entity/StudioCreature${suffix}.java`

test("稳重的反击可单独缩小正面半角，背后不触发", () => {
  expect(refused(withHurt({ front_yaw: 91 }))).toContain("90")
  const move = AbilitySchema.parse(withHurt({ front_yaw: 25 }))
  const java = String(compileEntity({ ...plain, model: fightingGolemDesign, behavior: "hostile",
    abilities: [move], steady: { preset: "huge" },
  })[entityPath()])
  expect(java).toContain("if (off > 90.0f) return -1;")
  expect(java).toContain("PARRY_FRONT_YAW = {25.0f};")
  expect(java).toContain("off > PARRY_FRONT_YAW[index]")
  expect(java).toContain("abilityTick == 0 && PARRY_CHANCE[abilityIndex] > 0.0f")
})

test("on_hurt is written as the plan says, waits its own cooldown, and an ability without it is what it was", () => {
  expect(AbilitySchema.parse(parryAbility)).toEqual(parryAbility)
  expect(parryAbility.on_hurt).toEqual({ chance: 0.3, cooldown: 1, by: "melee", block: true, disarm: { seconds: 3 } })
  // Its wait is on_hurt.cooldown (20 ticks), not start.cooldown (0).
  expect(abilityPlan(parryAbility).cooldown).toBe(20)
  expect(abilityPlan(slamAbility).cooldown).toBe(120)
  expect(AbilitySchema.parse(slamAbility)).not.toHaveProperty("on_hurt")
  // A disarm is optional; any blow may start it.
  expect(refused(withHurt({ disarm: undefined, by: "any", block: false }))).toBe("")
})

test("what an on_hurt may not be is said in plain words", () => {
  expect(refused({ ...parryAbility, start: { ...parryAbility.start, cooldown: 4 } })).toContain("start.cooldown 写 0")
  expect(refused({ ...parryAbility, dive: true })).toContain("不能是俯冲（dive）")
  expect(refused(withHurt({ chance: 0 }))).not.toBe("")
  expect(refused(withHurt({ chance: 1.2 }))).not.toBe("")
  expect(refused(withHurt({ by: "ranged" }))).not.toBe("")
  expect(refused(withHurt({ disarm: { seconds: PARRY_LIMITS.disarm.max + 1 } }))).not.toBe("")
  expect(refused(withHurt({ disarm: { seconds: 0.1 } }))).not.toBe("")
  expect(refused(withHurt({ cooldown: -1 }))).not.toBe("")
  // The creature as a whole: not a flier, not a combo step, not a boss's first attack.
  const said = (creature: Parameters<typeof parryDocumentIssues>[0]) => parryDocumentIssues(creature).map((issue) => issue.message).join(" ")
  expect(said({ abilities: [parryAbility, slamAbility] })).toBe("")
  expect(said({ abilities: [parryAbility], flight: {} })).toContain("会飞的生物")
  expect(said({ abilities: [parryAbility, slamAbility], combos: [{ name: "连环", steps: ["slam", "disarm"] }] })).toContain("连招「连环」的第 2 步 disarm 是被打中时才起的招式")
  expect(said({ abilities: [parryAbility], boss: { intro: { opening: "disarm" } } })).toContain("登场以后的第一招（opening）disarm")
  expect(creatureDocumentIssues({ behavior: "hostile", attack_damage: 4, abilities: [parryAbility, slamAbility], combos: [{ id: "both", name: "连环", steps: ["slam", "disarm"], gap_ticks: 0, damage_scale: 1, start: slamAbility.start }] } as never).some((issue) => issue.message.includes("是被打中时才起的招式"))).toBe(true)
})

test("the external AI is told how to write it, with every limit, and the summary says the blow, the chance, the parry, the disarm and the wait", () => {
  expect(ABILITY_INSTRUCTIONS).toContain(PARRY_INSTRUCTIONS)
  for (const words of ["on_hurt：{chance, cooldown, by, block, disarm}", `${PARRY_LIMITS.chance.min} 到 ${PARRY_LIMITS.chance.max}`, `${PARRY_LIMITS.disarm.min} 到 ${PARRY_LIMITS.disarm.max}`, "start.cooldown 写 0", "只缴打它的那一个人", "退出重进也还在"]) expect(PARRY_INSTRUCTIONS).toContain(words)
  expect(ABILITY_SUMMARY).toContain("被打中时才起")
  // The example in the instructions is a valid ability.
  const example = /例：夺兵——(\{.*\})。$/.exec(PARRY_INSTRUCTIONS)![1]!
  expect(refused(JSON.parse(example))).toBe("")
  const summary = abilityWords.summary(parryAbility)
  expect(summary).toStartWith("被近战打中（出手的人离它 0–5 格）的时候，有 30% 的机会会用")
  expect(summary).toContain("架住的那一下不掉血，出手的玩家缴械 3 秒（这期间近战打不出去，手里的东西显示冷却），用完歇 1 秒才会再被打出来")
  // An ability chosen by distance is said as it always was.
  expect(abilityWords.start(slamAbility)).toBe("目标在 0–3 格、看得见的时候")
})

test("the time line from the blow on: the parry, its counter, its wait and the disarm, in the numbers the game runs on, and its picture", () => {
  const line = parryTimeline(parryAbility)!
  expect(line).toEqual({ windup: 0.3, hits: [{ at: 0.6, damage: 4 }], end: 1, ready: 2, disarm: 3, block: true })
  expect(parryTimeline(slamAbility)).toBeNull()
  const words = parryTimelineWords(parryAbility)!
  expect(words.label).toContain("横轴 0–3 秒")
  expect(words.lines.join("")).toContain("第 0 秒被近战打中（出手的人离它 0–5 格）的时候，有 30% 的机会起招，架住这一下（不掉血）；蓄力到第 0.3 秒，第 0.6 秒出手反击，第 1 秒收招；歇到第 2 秒才会再被打出来。")
  expect(words.lines.join("")).toContain("出手的玩家从第 0 秒缴械到第 3 秒：只缴他一个人")
  expect(words.lines.join("")).toContain("缴械比它歇着还长")
  const picture = parryTimelinePicture(line)
  const decoded = decodeRgbaPng(picture.png)
  expect([decoded.width, decoded.height]).toEqual([480, 180])
  const at = (x: number, y: number) => Array.from(decoded.pixels.slice((y * decoded.width + x) * 4, (y * decoded.width + x) * 4 + 3))
  // The rows: the parry getting ready (0–0.3 s) and after it, the wait (1–2 s), the disarm (0–3 s); the counter's red mark at 0.6 s.
  expect(at(picture.x(0.15), 40)).toEqual([...PARRY_COLOURS.windup])
  expect(at(picture.x(0.8), 40)).toEqual([...PARRY_COLOURS.ability])
  expect(at(picture.x(0.6), 40)).toEqual([...PARRY_COLOURS.hit])
  expect(at(picture.x(1.5), 90)).toEqual([...PARRY_COLOURS.wait])
  expect(at(picture.x(0.5), 90)).toEqual([...PARRY_COLOURS.back])
  expect(at(picture.x(2.5), 136)).toEqual([...PARRY_COLOURS.disarm])
  expect(at(picture.x(0), 100)).toEqual([...PARRY_COLOURS.blow])
})

test("the reviewer: a chance so high, no wait, a disarm that keeps a player from ever landing, a window no melee comes from, and a creature that never strikes first", () => {
  const texts = (abilities: Ability[], hitbox: { core?: { width?: number | null } | null } | null = null) => parryReview({ name: "兵主", abilities, hitbox }).map((issue) => issue.text).join("\n")
  // The check's sample (30%, a second's wait, three seconds disarmed, made to parry often): under a third of one player's melee lands, and the reviewer says so.
  expect(parryShare(parryAbility)!.share).toBeCloseTo(0.2869, 3)
  expect(texts([parryAbility, slamAbility])).toContain("用完只歇 1 秒就又能被打出来")
  expect(texts([parryAbility, slamAbility])).toContain("他的近战只有 28.7% 能打上去")
  // The move table's (15%, 8 seconds, 3 seconds disarmed): nothing said.
  expect(texts([bossParryAbility, slamAbility])).toBe("")
  expect(parryShare(bossParryAbility)!.share).toBeCloseTo(0.7247, 3)
  // Every blow parried, no wait, a disarm longer than the parry: one player's melee never lands.
  const wall = AbilitySchema.parse(withHurt({ chance: 1, cooldown: 0 }))
  expect(parryShare(wall)!.share).toBe(0)
  const said = texts([wall, slamAbility])
  expect(said).toContain("用完马上就又能被打出来")
  expect(said).toContain("被打中时有 100% 的机会起")
  expect(said).toContain("让近战几乎打不动它")
  expect(said).toContain("他的近战只有 0% 能打上去")
  // Without the disarm the blows during the parry land: less is said.
  expect(parryShare(AbilitySchema.parse(withHurt({ chance: 1, cooldown: 0, disarm: undefined })))!.share).toBeCloseTo(0.6154, 3)
  // A melee parry that waits for an attacker further than a melee reaches.
  expect(texts([AbilitySchema.parse({ ...bossParryAbility, start: { ...bossParryAbility.start, min_distance: 6, max_distance: 8 } }), slamAbility])).toContain("永远起不来")
  expect(texts([AbilitySchema.parse({ ...bossParryAbility, start: { ...bossParryAbility.start, min_distance: 4, max_distance: 8 } }), slamAbility], { core: { width: 3 } })).toBe("")
  // A melee parry whose window ends about where a melee reaches: knocked back a block, it is out of reach (a wide creature reaches farther).
  expect(texts([AbilitySchema.parse({ ...bossParryAbility, start: { ...bossParryAbility.start, max_distance: 4 } }), slamAbility])).toContain("这一招就起不来了")
  expect(texts([bossParryAbility, slamAbility], { core: { width: 4 } })).toContain("近战在离它中心约 5.3 格的地方就能打到它")
  expect(texts([bossParryAbility])).toContain("一下也不出手")
  // They reach the creature's own findings, never as a stop.
  const issues = abilityIssues({ name: "兵主", behavior: "hostile", abilities: [wall, slamAbility] }, null)
  expect(issues.filter((issue) => issue.rule === "ability_parry").length).toBe(3)
  expect(issues.every((issue) => !issue.stops)).toBe(true)
})

test("the creature's class answers a blow before it hurts, keeps the parry out of the distance chooser, and a class without one is what it was", () => {
  const java = String(compileEntity({ ...plain, abilities: [parryAbility, slamAbility] } as never)[entityPath()])
  expect(java).toContain("private static final float[] PARRY_CHANCE = {0.3f, 0.0f};")
  expect(java).toContain("private static final boolean[] PARRY_MELEE = {true, false};")
  expect(java).toContain("private static final boolean[] PARRY_BLOCKS = {true, false};")
  expect(java).toContain("private static final int[] PARRY_DISARM = {60, 0};")
  expect(java).toContain("private static final int[] ABILITY_COOLDOWN = {20, 120};")
  expect(java).toContain("            case 0 -> false;")
  expect(java).toContain("            case 1 -> distance >= 0.0 && distance <= 3.0 && hasLineOfSight(target);")
  expect(java).toContain("            case 0 -> distance >= 0.0 && distance <= 5.0;")
  expect(java).toContain("        int parried = abilityParry(source, amount);\n        if (parried >= 0 && PARRY_BLOCKS[parried]) return false;\n        boolean hurt = super.hurt(source, amount);")
  expect(java).toContain(`${DISARM.runtime}.disarm(struck, PARRY_DISARM[index]);`)
  expect(java).toContain("if (getTarget() != attacker) setTarget(attacker);")
  // Neither the blow's kind nor the source's directness is a 1.21-only name.
  expect(java).not.toContain("isDirect()")
  // Stopped by being hurt: not by the very blow that started it.
  const stopped = String(compileEntity({ ...plain, abilities: [AbilitySchema.parse({ ...parryAbility, stopped_by_hurt: true }), slamAbility] } as never)[entityPath()])
  expect(stopped).toContain("if (hurt && parried < 0 && !level().isClientSide() && abilityIndex >= 0 && ABILITY_HURT_STOPS[abilityIndex]) stopAbility();")
  // Without a block or a disarm those lines are left out.
  const open = String(compileEntity({ ...plain, abilities: [AbilitySchema.parse(withHurt({ block: false, disarm: undefined })), slamAbility] } as never)[entityPath()])
  expect(open).not.toMatch(/PARRY_BLOCKS|PARRY_DISARM|StudioDisarm/)
  // An ordinary creature's class names nothing of it.
  const old = String(compileEntity({ ...plain, abilities: [slamAbility] } as never)[entityPath()])
  expect(old).not.toMatch(/PARRY_|abilityParry|StudioDisarm|parried/)
})

test("the disarm's class: Fabric names it as an entry point with Fabric API's callbacks, a facade target runs it from the common entry through onAttack", () => {
  const fabric = compileDisarm({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod" })
  const fabricJava = Object.values(fabric.files)[0]!
  expect(fabricJava).toContain("public final class StudioDisarm implements ModInitializer")
  expect(fabricJava).toContain("AttackEntityCallback.EVENT.register((player, level, hand, entity, hit) -> allows(player) ? InteractionResult.PASS : InteractionResult.FAIL);")
  expect(fabricJava).toContain('Component.translatable("golem_mod.disarmed"')
  expect(fabric.entries).toEqual({ common: [], client: [] })
  const metadata = JSON.parse(fabric.patch["src/main/resources/fabric.mod.json"]!(JSON.stringify({ entrypoints: { main: ["a.StudioContent"] } })))
  expect(metadata.entrypoints.main).toEqual(["a.StudioContent", "com.minemods.content_golem_mod.entity.StudioDisarm"])
  expect(fabric.language.zh_cn["golem_mod.disarmed"]).toContain("%s 秒内不能近战攻击")
  expect(fabric.language.en_us["golem_mod.disarmed"]).toContain("%s")
  for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
    const made = compileDisarm({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod" }, genTarget(target))
    const java = Object.values(made.files)[0]!
    expect(java).toContain("StudioPlatform.onAttack((player, target) -> allows(player));")
    expect(java).toContain("StudioPlatform.onPlayerJoin(StudioDisarm::rejoined);")
    expect(java).not.toMatch(/^import net\.(fabricmc|minecraftforge|neoforged)\./m)
    expect(made.patch).toEqual({})
    expect(made.entries.common).toEqual(["com.minemods.content_golem_mod.entity.StudioDisarm"])
  }
})

test.skipIf(!hasTargetJavac(CLASSPATH["fabric-1.21.1"]))("on Fabric a creature with a parry compiles, alone, as a boss and beside a combo", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-parry-"))
  roots.push(root)
  const boss = BossSchema.parse({ bar: { color: "red", style: "progress", darken_sky: false }, intro: null, phases: [{ below: 0.66, clip: null, seconds: 1, bar_color: null, speed: 1, damage: 1.2, add: ["disarm"] }], death: { seconds: 2, xp_bursts: 0, explosion: false }, leash: null })
  const shapes = [
    { classSuffix: "", abilities: [parryAbility, slamAbility] },
    { classSuffix: "B", abilities: [bossParryAbility, slamAbility], boss },
    { classSuffix: "C", abilities: [AbilitySchema.parse({ ...parryAbility, stopped_by_hurt: true }), slamAbility, { ...slamAbility, id: "slam_two" }], combos: [{ id: "double", name: "双锤", steps: ["slam", "slam_two"], gap_ticks: 2, damage_scale: 1, start: slamAbility.start }] },
  ]
  for (const shape of shapes) {
    const files = compileEntity({ ...plain, ...shape } as never)
    await writeFile(path.join(root, `StudioCreature${shape.classSuffix}.java`), String(files[entityPath(shape.classSuffix)]))
  }
  const support = [compileDisarm({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod" }), compileBossRuntime({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", shake: false, debris: false })]
  for (const files of support) for (const [name, text] of Object.entries(files.files)) await writeFile(path.join(root, path.basename(name)), String(text))
  const compiled = await targetJavac(CLASSPATH["fabric-1.21.1"], root)
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 180000)

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: the parry sample's whole tree is assembled by Studio's own build and compiles against the real class path`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-parry-tree-"))
    roots.push(root)
    const project = await createTargetParrySample(path.join(root, "涿鹿夺兵"), target)
    const source = path.join(root, "source")
    await mkdir(source)
    await assembleBuildSource(path.join(root, "涿鹿夺兵"), source, TEMPLATE)
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".java")).map((entry) => path.join(entry.parentPath, entry.name))
    const creatures = await Promise.all(names.filter((name) => /StudioCreatureEntity\d_\w+\.java$/.test(name) && !/Renderer|Model/.test(name)).map((name) => readFile(name, "utf8")))
    expect(creatures.filter((text) => text.includes("private int abilityParry(DamageSource source, float amount)")).length).toBe(2)
    // The boss allows it by its phase.
    expect(creatures.some((text) => text.includes("tickCount < abilityReadyAt[index] || !bossAllows(index)"))).toBe(true)
    expect(names.some((name) => name.endsWith(`${DISARM.runtime}.java`))).toBe(true)
    const lang = JSON.parse(await readFile(path.join(source, "src", "main", "resources", "assets", project.mod_id, "lang", "zh_cn.json"), "utf8"))
    expect(lang[DISARM.key(project.mod_id)]).toBe("兵器被夺：%s 秒内不能近战攻击")
    const common = await readFile(path.join(source, "src", "main", "java", ...`com.minemods.content_${project.mod_id}`.split("."), "StudioContent.java"), "utf8")
    expect(common.includes(`entity.${DISARM.runtime}.register();`)).toBe(target !== "fabric-1.21.1")
    // The common layer names no loader.
    expect(creatures.every((text) => !/^import net\.(minecraftforge|neoforged|fabricmc)\./m.test(text))).toBe(true)
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

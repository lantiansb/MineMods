import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { BOSS_BASE_INSTRUCTIONS, bossBaseWords } from "../src/boss-base"
import { BOSS_BASE_LIMITS } from "../src/boss-words"
import { BOSS_INSTRUCTIONS, BOSS_SUMMARY, BOSS_VALUE_GUIDE, bossOwn, bossWords } from "../src/creature-boss"
import { BossSchema, EntitySchema } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign } from "../script/data-gameplay-sample"
import { createTargetBossBaseSample, ironWall, ironWallBase, sleepingWall } from "../script/target-boss-base-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const wall = ironWall()
const boss = wall.boss!
const plain = { modId: "iron_wall", packageName: "com.minemods.content_iron_wall", id: "creature", name: "铁壁将", health: 600, speed: 0.25, attack_damage: 6, behavior: "hostile" as const, model: fightingGolemDesign }
const entityPath = "src/main/java/com/minemods/content_iron_wall/entity/StudioCreature.java"
const java = (more: Record<string, unknown>) => String(compileEntity({ ...plain, abilities: wall.abilities, ...more } as never)[entityPath])
const refused = (change: Record<string, unknown>) => BossSchema.safeParse({ ...boss, ...change }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
const document = (change: Record<string, unknown>, health = 600) => EntitySchema.safeParse({ ...wall, health, boss: { ...boss, ...change } }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
const NAMES = ["BOSS_DAMAGE_CAP", "BOSS_DPS_AMOUNT", "bossWindow", "bossTaken", "BOSS_REGEN", "bossQuiet", "BOSS_SCALE_", "bossScale", "bossExtra", "BossExtra", "BOSS_BASE_HEALTH", "bossPlayersMore"]

test("the four fields are optional and bounded; what cannot be played as written is refused in plain words", () => {
  expect(refused({})).toBe("")
  const old = { ...boss, damage_cap: undefined, dps_cap: undefined, regen: undefined, scaling: undefined }
  expect(BossSchema.safeParse(old).success).toBe(true)
  expect(BossSchema.safeParse({ ...old, damage_cap: null, dps_cap: null, regen: null, scaling: null }).success).toBe(true)
  expect(refused({ damage_cap: 0 })).not.toBe("")
  expect(refused({ damage_cap: BOSS_BASE_LIMITS.cap.max + 1 })).not.toBe("")
  expect(refused({ dps_cap: { amount: 120, seconds: 31 } })).not.toBe("")
  expect(refused({ dps_cap: { amount: 120 } })).not.toBe("")
  expect(refused({ regen: { per_second: 0.05, after_seconds_without_damage: 3, in_fight: false } })).not.toBe("")
  expect(refused({ regen: { per_second: 10, after_seconds_without_damage: 121, in_fight: false } })).not.toBe("")
  expect(refused({ scaling: { ...ironWallBase.scaling, max_players: 1 } })).not.toBe("")
  expect(refused({ scaling: { ...ironWallBase.scaling, max_players: 2.5 } })).not.toBe("")
  expect(refused({ scaling: { ...ironWallBase.scaling, per_extra_player: { health: 3, damage: 0.2 } } })).not.toBe("")
  expect(refused({ scaling: { ...ironWallBase.scaling, extra: 1 } })).not.toBe("")
  // Against the creature's own life.
  expect(document({})).toBe("")
  expect(document({ damage_cap: 600 })).toContain("单次最多掉的血（damage_cap 600）不比它的满血（600）少")
  expect(document({ damage_cap: 600 })).toContain("这只大约 24–36")
  expect(document({ dps_cap: { amount: 30, seconds: 5 } })).toContain("比单次最多掉的血（damage_cap 40）还少")
  expect(document({ regen: { per_second: 30, after_seconds_without_damage: 0, in_fight: true } })).toContain("它永远打不死")
  expect(document({ regen: { per_second: 30, after_seconds_without_damage: 1, in_fight: true } })).toBe("")
  expect(document({ regen: { per_second: 30, after_seconds_without_damage: 0, in_fight: false } })).toBe("")
})

test("the words say what the boss's own base does, with its life where it is known", () => {
  const words = bossBaseWords(boss, 600)
  expect(words).toBe(
    "单次最多掉 40 血（多大的伤害都只掉这么多，掉进虚空和 /kill 不算）；每 5 秒最多掉 120 血（掉够了，这段时间里再打也不掉；就算一直打，满血 600 也要 25 秒以上）；3 秒没掉血、身边没有要打的人时，每秒回 10 血（回不过满血，也不会回到上一个阶段）；16 格内每多一个玩家（最多算 4 个）满血多 50%、伤害多 20%（满血最多 1024，游戏的上限是 1024），人走了再降回来，血量按比例跟着变，血条和阶段线不乱",
  )
  expect(bossBaseWords({ ...boss, scaling: { ...ironWallBase.scaling, max_players: 2 } }, 600)).toContain("（满血最多 900）")
  expect(bossBaseWords(sleepingWall().boss!)).toBe("单次最多掉 25 血（多大的伤害都只掉这么多，掉进虚空和 /kill 不算）；2 秒没掉血时，每秒回 2 血（回不过满血，也不会回到上一个阶段）")
  expect(bossBaseWords({})).toBe("")
  // The boss's summary and the creature's card carry it; a boss without it says what it always said.
  expect(bossWords.summary(boss, [], "\n", bossOwn(wall)).split("\n")).toContain(words)
  const without = { ...boss, damage_cap: undefined, dps_cap: undefined, regen: undefined, scaling: undefined }
  expect(bossWords.summary(without, [], "\n").split("\n")).toHaveLength(bossWords.summary(boss, [], "\n").split("\n").length - 1)
  // The AI is told all four with the numbers an epic boss starts from, in the guide, the value guide and the summary.
  expect(BOSS_INSTRUCTIONS).toContain(BOSS_BASE_INSTRUCTIONS)
  for (const field of ["damage_cap", "dps_cap", "regen", "after_seconds_without_damage", "in_fight", "scaling", "per_extra_player", "max_players", "4%–6%"]) expect(BOSS_BASE_INSTRUCTIONS).toContain(field)
  expect(BOSS_VALUE_GUIDE).toContain("damage_cap（满血的 4%–6%）")
  expect(BOSS_SUMMARY).toContain("一下最多掉多少血")
  const example = JSON.parse(/例（满血 600 的史诗 Boss）：(\{.*\})。$/.exec(BOSS_BASE_INSTRUCTIONS)![1]!)
  expect(document(example)).toBe("")
})

test("a boss without any of it is the Java it always was; each piece is written only where it is used", () => {
  const without = { ...boss, damage_cap: undefined, dps_cap: undefined, regen: undefined, scaling: undefined }
  const old = java({ boss: without })
  expect(java({ boss: { ...without, damage_cap: null, dps_cap: null, regen: null, scaling: null } })).toBe(old)
  for (const name of NAMES) expect(old).not.toContain(name)
  expect(old).toContain("private float bossDamageScale() { return (float) BOSS_DAMAGE[Math.min(bossPhase(), BOSS_DAMAGE.length - 1)]; }")
  expect(old).toContain("if (damage != null) damage.setBaseValue(BOSS_BASE_DAMAGE * BOSS_DAMAGE[phase]);")
  const all = java({ boss })
  expect(all).toContain("private static final float BOSS_DAMAGE_CAP = 40.0f;")
  expect(all).toContain("private static final int BOSS_DPS_TICKS = 100;")
  expect(all).toContain("private static final float BOSS_REGEN = 0.5f;")
  expect(all).toContain("private static final int BOSS_REGEN_AFTER = 60;")
  expect(all).toContain("private static final double BOSS_BASE_HEALTH = 600.0;")
  expect(all).toContain("super.actuallyHurt(source, amount);\n        if (!level().isClientSide()) bossTaken(source, before);")
  expect(all).toContain("else if (getHealth() < getMaxHealth() && getTarget() == null) heal(BOSS_REGEN);")
  expect(all).toContain("if (bossState() != BOSS_DORMANT && tickCount % BOSS_WATCH == 0) bossScale(bossPlayersMore());")
  expect(all).toContain("bossScale(0);\n        bossQuiet = 0;\n        setHealth(getMaxHealth());")
  expect(all).toContain("private float bossDamageScale() { return (float) (BOSS_DAMAGE[Math.min(bossPhase(), BOSS_DAMAGE.length - 1)] * bossScaleDamage()); }")
  expect(all).toContain('nbt.putInt("BossExtra", bossExtra);')
  // The void and /kill pass; a phase's line is still where it was (the clamp the reviewer's contract reads).
  expect(all).toContain("source.is(DamageTypeTags.BYPASSES_INVULNERABILITY)) return;")
  expect(all).toMatch(/\(before > line && getHealth\(\) <= line\) \{\s*setHealth\(line\);/)
  // Only a cap: no window, no quiet, no scaling.
  const capped = java({ boss: { ...without, damage_cap: 40 } })
  expect(capped).toContain("float kept = Math.min(lost, BOSS_DAMAGE_CAP);\n        if (kept < lost) setHealth(before - kept);")
  for (const name of ["BOSS_DPS_AMOUNT", "bossQuiet", "bossScale", "BossExtra", "bossLost"]) expect(capped).not.toContain(name)
  // Only its life coming back, in the fight too: the quiet, no cap.
  const healing = java({ boss: { ...without, regen: { per_second: 2, after_seconds_without_damage: 2, in_fight: true } } })
  expect(healing).toContain("else if (getHealth() < getMaxHealth()) heal(BOSS_REGEN);")
  expect(healing).not.toContain("BOSS_DAMAGE_CAP")
  expect(healing).not.toContain("float kept")
  expect(healing).not.toContain("bossTaken")
  expect(healing).toContain("if (lost <= 0.0f || source.is(DamageTypeTags.BYPASSES_INVULNERABILITY)) return;\n        bossQuiet = 0;\n    }")
})

test("the window and the quiet count what a blow took in the end: after the caps and after the line of its phase, and nothing for a blow given back in full", () => {
  const all = java({ boss })
  const method = (signature: string) => {
    const start = all.indexOf(signature)
    expect(start).toBeGreaterThanOrEqual(0)
    return all.slice(start, all.indexOf("\n    }\n", start))
  }
  // Its actuallyHurt: the caps first (they decide whether the line is crossed), then the line, then what it lost in the end.
  const hurt = method("@Override protected void actuallyHurt(")
  const order = ["super.actuallyHurt(source, amount);", "bossTaken(source, before);", "setHealth(line);", "bossChange(bossPhase() + 1);", "bossLost(source, before);"].map((word) => hurt.indexOf(word))
  expect(order.every((at) => at >= 0)).toBe(true)
  expect(order).toEqual([...order].sort((a, b) => a - b))
  // No early return that would skip what it lost: a blow on a creature already past its last line, or changing phase, still counts.
  expect(hurt).not.toContain("return;")
  // The caps only give back; they neither fill the window nor break the quiet.
  const taken = method("private void bossTaken(")
  for (const word of ["bossWindow[slot] +=", "bossWindowAt[slot] =", "bossQuiet"]) expect(taken).not.toContain(word)
  expect(taken).toContain("kept = Math.max(0.0f, Math.min(kept, BOSS_DPS_AMOUNT - window));")
  // What it lost in the end fills the window and breaks the quiet, only when it is more than nothing.
  const lost = method("private void bossLost(")
  expect(lost).toContain("float lost = before - getHealth();\n        if (lost <= 0.0f || source.is(DamageTypeTags.BYPASSES_INVULNERABILITY)) return;\n        bossQuiet = 0;")
  expect(lost).toContain("bossWindow[slot] += lost;")
  expect(lost.indexOf("return;")).toBeLessThan(lost.indexOf("bossQuiet = 0;"))
  // A boss with none of the window or the quiet keeps its actuallyHurt as it was.
  const plainHurt = java({ boss: { ...boss, damage_cap: 40, dps_cap: undefined, regen: undefined, scaling: undefined } })
  expect(plainHurt).toContain("if (!level().isClientSide()) bossTaken(source, before);\n        if (level().isClientSide() || bossState() != BOSS_FIGHT || bossPhase() >= BOSS_BELOW.length) return;")
})

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: a boss with all four, and one with a wake-up and some of them, are assembled by Studio's own build and compile against the real class path`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-boss-base-"))
    roots.push(root)
    await createTargetBossBaseSample(path.join(root, "铁壁关"), target)
    const source = path.join(root, "source")
    await mkdir(source)
    await assembleBuildSource(path.join(root, "铁壁关"), source, TEMPLATE)
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".java")).map((entry) => path.join(entry.parentPath, entry.name))
    const creatures = await Promise.all(names.filter((name) => /StudioCreatureEntity\d_\w+\.java$/.test(name) && !/Renderer|Model/.test(name)).map((name) => readFile(name, "utf8")))
    expect(creatures.some((text) => text.includes("bossPlayersMore()") && text.includes("BOSS_DPS_AMOUNT") && text.includes("heal(BOSS_REGEN)"))).toBe(true)
    expect(creatures.some((text) => text.includes("BOSS_DAMAGE_CAP = 25.0f") && !text.includes("BOSS_DPS_AMOUNT"))).toBe(true)
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

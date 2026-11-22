import { expect, test } from "bun:test"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { assembleBuildSource } from "../src/build-source"
import { EntitySchema, HitboxPartSchema, HitboxSchema } from "../src/entity-runtime"
import { hitboxCombatIssues, HITBOX_COMBAT_INSTRUCTIONS } from "../src/hitbox-combat"
import { hitboxAppearance, hitboxBoxes, hitboxLines, hitboxFit } from "../src/creature-hitbox"
import { compileEntity } from "../src/fabric/entity"
import { compileHitboxParts } from "../src/fabric/hitbox"
import { genTarget } from "../src/platform/target"
import { fightingGolemDesign, longCreatureHitbox } from "../script/data-gameplay-sample"
import { combatHitbox, createTargetHitboxSample, partAbility, partBoss } from "../script/target-hitbox-sample"
import { createTargetSolidBodySample } from "../script/target-solid-body-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

const plain = { modId: "parts_check", packageName: "com.minemods.content_parts_check", id: "creature", name: "试验", health: 200, speed: 0.2, attack_damage: 0, behavior: "passive" as const, model: fightingGolemDesign, hitbox: longCreatureHitbox }
const creature = { id: "11111111-1111-4111-8111-111111111111", name: "守卫", description: "", health: 200, speed: 0.2, attack_damage: 0, behavior: "hostile", model_asset_id: null, hitbox: combatHitbox, abilities: [partAbility], boss: partBoss }

test("blockers have their own budget and no damage, click or projectile target", () => {
  const rail = { name: "护栏", width: 1, height: 2, forward: 1, left: 0, up: 0 }
  const parts = Array.from({ length: 16 }, (_, i) => ({ ...rail, name: "受击" + i }))
  const blockers = Array.from({ length: 8 }, (_, i) => ({ ...rail, name: "护栏" + i }))
  const body = { core: { width: 1, height: 1 }, parts, blockers }
  expect(HitboxSchema.parse(body)).toEqual(body)
  for (const [list, message] of [[[...blockers, rail], "最多 8 个"], [[{ ...rail, width: 0 }], "至少 0.1"], [[{ ...rail, forward: 20 }], "最远 16 格"], [[{ ...rail, damage_scale: 0 }], "受击"], [[parts[0]], "重名"]] as const) {
    expect(HitboxSchema.safeParse({ ...body, blockers: list }).error?.issues[0]?.message).toContain(message)
  }
  const shared = Object.values(compileHitboxParts({ modId: plain.modId, packageName: plain.packageName, solid: true, blockers: true }).files).join("\n")
  for (const guard of ["boolean canBeHitByProjectile()", "if (!isPickable()) return true;", "if (!isPickable()) return false;", "if (!isPickable()) return InteractionResult.PASS;"]) expect(shared).toContain(guard)
  const generated = Object.values(compileEntity({ ...plain, hitbox: body })).join("\n")
  expect(generated).toContain("index >= 0 && index < 16")
  expect(generated).toContain("return index >= 16 ||")
})

test("part combat schema accepts all optional fields and rejects bad scales, phases and contact references in Chinese", () => {
  expect(EntitySchema.parse(creature).hitbox).toEqual(combatHitbox)
  const part = combatHitbox.parts![0]!
  for (const damage_scale of [-1, 17]) expect(HitboxPartSchema.safeParse({ ...part, damage_scale }).error?.issues[0]!.message).toContain("倍率")
  expect(HitboxPartSchema.safeParse({ ...part, phase_scales: [{ phase: 1, damage_scale: 2 }, { phase: 1, damage_scale: 0 }] }).error?.issues[0]!.message).toContain("同一阶段")
  for (const bad of [
    { ...creature, boss: null },
    { ...creature, boss: { ...partBoss, phases: [] } },
    { ...creature, behavior: "passive" },
    { ...creature, abilities: [] },
    { ...creature, hitbox: { ...combatHitbox, parts: [{ ...part, contact: [{ ability: "sweep", from: 1.1, to: 2, damage: 6, knockback: 1 }] }] } },
    { ...creature, hitbox: { ...combatHitbox, parts: [{ ...part, contact: [{ ability: "sweep", from: 0.001, to: 0.002, damage: 6, knockback: 1 }] }] } },
  ]) {
    const parsed = EntitySchema.safeParse(bad)
    expect(parsed.success).toBe(false)
    expect(parsed.error!.issues.some((issue) => /部位|接触伤害/.test(issue.message))).toBe(true)
  }
  expect(HitboxPartSchema.safeParse({ ...part, contact: [{ ability: "sweep", from: 1, to: 0.5, damage: 6, knockback: 1 }] }).error?.issues[0]!.message).toContain("晚于")
  expect(hitboxCombatIssues(creature)).toEqual([])
  expect(HitboxSchema.parse(longCreatureHitbox)).toEqual(longCreatureHitbox)
})

test("look distinguishes weak points, armour and immunity and documents the exact per-attack contract", () => {
  const design = ModelDesignSchema.parse(fightingGolemDesign)
  const boxes = hitboxBoxes(combatHitbox, design)
  expect(hitboxAppearance(boxes[1]!)).toEqual({ fill: "#ef476f", stroke: "rgb(176, 20, 62)" })
  expect(hitboxAppearance(boxes[2]!)).toEqual(hitboxAppearance(boxes[3]!))
  expect(hitboxAppearance(boxes[0]!)).not.toEqual(hitboxAppearance(boxes[1]!))
  expect(hitboxLines(hitboxFit(combatHitbox, design)).join(" ")).toContain("倍率")
  expect(HITBOX_COMBAT_INSTRUCTIONS).toContain("同一招的所有部位合起来对同一玩家只打一次")
})

test("part melee scaling composes with the owner's existing hurt interruption and keeps client attack cooldowns", () => {
  const files = compileEntity({ ...plain, behavior: "hostile", hitbox: combatHitbox, boss: partBoss, abilities: [{ ...partAbility, stopped_by_hurt: true }] })
  const java = String(files["src/main/java/com/minemods/content_parts_check/entity/StudioCreature.java"])
  expect(java.match(/@Override public boolean hurt\(/g)).toHaveLength(1)
  expect(java).toContain("amount = hitboxDamage(part, amount);")
  expect(java).toContain("if (hurt && !level().isClientSide() && abilityIndex >= 0")
  expect(java).toContain("try { player.attack(this); }")
  expect(java).not.toContain("if (level().isClientSide() || !isAlive()) return;")
})

test("a part's scale comes before the boss base caps: the owner's hurt scales, its actuallyHurt holds damage_cap and dps_cap", () => {
  const boss = { ...partBoss, damage_cap: 25, dps_cap: { amount: 60, seconds: 5 }, scaling: { per_extra_player: { health: 0.5, damage: 0.2 }, radius: 16, max_players: 4 } }
  const files = compileEntity({ ...plain, behavior: "hostile", hitbox: combatHitbox, boss, abilities: [{ ...partAbility, stopped_by_hurt: true }] })
  const java = String(files["src/main/java/com/minemods/content_parts_check/entity/StudioCreature.java"])
  const method = (signature: string) => {
    const start = java.indexOf(signature)
    expect(start).toBeGreaterThanOrEqual(0)
    return java.slice(start, java.indexOf("\n    }\n", start))
  }
  const hurt = method("@Override public boolean hurt(")
  expect(hurt.indexOf("amount = hitboxDamage(part, amount);")).toBeGreaterThanOrEqual(0)
  expect(hurt.indexOf("amount = hitboxDamage(part, amount);")).toBeLessThan(hurt.indexOf("super.hurt(source, amount)"))
  const actually = method("@Override protected void actuallyHurt(")
  expect(actually).toContain("super.actuallyHurt(source, amount);")
  expect(actually).toContain("bossTaken(source, before);")
  expect(actually).not.toContain("hitboxDamage")
  expect(method("private float hitboxDamage(")).not.toMatch(/setHealth|BOSS_DAMAGE_CAP|BOSS_DPS/)
  expect(java).toContain("Math.min(lost, BOSS_DAMAGE_CAP)")
  // A weapon's contact damage grows with the players near, like every other blow of the boss.
  expect(java).toContain("6f * bossDamageScale()")
  expect(java).toMatch(/private float bossDamageScale\(\) \{[^\n]*bossScaleDamage\(\)/)
})

const hashes = {
  "fabric-1.21.1": ["566c43d300e792c4bba379b5287cf107f2fc03ea3412dfddfd1e0461777616f1", "4ced776dbe166d2bd68105d6edca557e04262a99365b6f673143255c52869de9"],
  "forge-1.20.1": ["86445d69d342f36bda3da46a3b6cb6d3c15897168f2667d529a485d8c87e37bb", "e603e22685c5f361b5e0ab30613f0a741c462fdc1c5765de0337706510866e73"],
  "neoforge-1.21.1": ["1bd7abeb578cac44d1c4cb966652acffa266ae35d9fa1a245797b76715d199dc", "383e76e41c306083027e610bb4b5863b3b4ca0d2f5577f9d191eeb7e6523bb82"],
} as const
for (const target of Object.keys(hashes) as (keyof typeof hashes)[]) {
  test(`${target}: old creature and shared part runtime remain byte-identical to 5fbd922`, () => {
    const hash = (value: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex")
    expect(hash(compileEntity(plain, genTarget(target)))).toBe(hashes[target][0])
    expect(hash(compileHitboxParts({ modId: plain.modId, packageName: plain.packageName }, genTarget(target)).files)).toBe(hashes[target][1])
  })
  test(`${target}: omitted surfaces and explicit empty surfaces generate identical files`, () => {
    const targetProfile = genTarget(target)
    const hitbox = { ...longCreatureHitbox, core: { ...longCreatureHitbox.core, solid: false }, blockers: [] }
    expect(compileEntity({ ...plain, hitbox }, targetProfile)).toEqual(compileEntity(plain, targetProfile))
  })
  const classpath = target === "fabric-1.21.1" ? `${target}-official` : target
  test.skipIf(!hasTargetJavac(classpath))(`${target}: turtle core, independent rail and sixteen-part fortress compile together`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "fortress-rail-"))
    try {
      await createTargetSolidBodySample(path.join(root, "project"), target, true, true)
      const source = path.join(root, "source")
      await mkdir(source)
      await assembleBuildSource(path.join(root, "project"), source, path.resolve(import.meta.dir, "../../../templates/fabric-1.21"))
      const entityFolder = path.join(source, "src/main/java/com/minemods/content_solid_body_yard/entity")
      const sources = await Promise.all((await readdir(entityFolder)).filter(name => name.endsWith(".java")).map(name => readFile(path.join(entityFolder, name), "utf8")))
      expect(sources.some(text => text.includes("StudioSolidBody.clear(this, null, solidBoxes)"))).toBe(true)
      expect(sources.some(text => text.includes("index < 16;") && text.includes("HITBOX_PARTS.length + 1"))).toBe(true)
      expect(sources.some(text => text.includes("if (!isPickable()) return false;"))).toBe(true)
      const result = await targetJavac(classpath, path.join(source, "src/main/java"))
      expect(result.output.split("\n").filter(line => /error/.test(line))).toEqual([])
      expect(result.code).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 180000)
  test.skipIf(!hasTargetJavac(classpath))(`${target}: full Boss with all part combat fields compiles on the real classpath`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "parts-combat-"))
    const project = path.join(root, "project")
    const source = path.join(root, "source")
    await createTargetHitboxSample(project, target)
    await mkdir(source)
    await assembleBuildSource(project, source, path.resolve(import.meta.dir, "../../../templates/fabric-1.21"))
    const result = await targetJavac(classpath, path.join(source, "src/main/java"))
    expect(result.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(result.code).toBe(0)
  }, 180000)
}

import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ABILITY_SOUNDS } from "../src/ability-words"
import { BOSS_BAR_COLOR_IDS, BOSS_BAR_STYLE_IDS, BOSS_LIMITS, DEBRIS_LIMITS, SHAKE_LIMITS } from "../src/boss-words"
import { soundConstant } from "../src/data-words"
import { assembleBuildSource } from "../src/build-source"
import { BOSS_EVENT_INSTRUCTIONS, BOSS_INSTRUCTIONS, BOSS_SUMMARY, bossMasks, bossModelIssues, bossPlan, bossWords, felt } from "../src/creature-boss"
import { ABILITY_INSTRUCTIONS, creatureBindings } from "../src/creature-abilities"
import { BossSchema, EntitySchema, AbilitySchema, type Ability, type Boss } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { BOSS_RUNTIME, compileBossRuntime } from "../src/fabric/boss-runtime"
import { saveProject } from "../src/project"
import { reconcile } from "../src/reconcile"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac, targetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-boss-"))
  roots.push(root)
  return root
}

const [slam, burst] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability, Ability]
// The golem's own motions stand in for the boss's: "roar" (0.8 s) is the wake-up, "wave" (1 s) the change of phase.
const boss: Boss = BossSchema.parse({
  bar: { color: "purple", style: "notched_10", darken_sky: true },
  intro: { wake_distance: 16, clip: "roar", seconds: 0.8, sound: "entity.iron_golem.attack" },
  phases: [
    { below: 0.66, clip: "wave", seconds: 1, bar_color: "red", speed: 1.15, damage: 1.3, abilities: ["slam"] },
    { below: 0.33, clip: "wave", seconds: 1, bar_color: null, speed: 1.3, damage: 1.6, abilities: [] },
  ],
  death: { seconds: 4, xp_bursts: 6, explosion: true },
  leash: { distance: 48, reset_seconds: 30 },
})
const shake = { type: "shake" as const, at: 0.7, strength: 2, radius: 16, seconds: 1 }
const debris = { type: "debris" as const, at: 0.7, where: "self" as const, hit: null, forward: 1.2, up: 0, left: 0, radius: 3, count: 10 }
const felt2: Ability[] = [{ ...slam, events: [...slam.events, shake, debris] }, burst]
const runtime = { spawn: null, explosion: null, movement: "direct" as const, armor: 0, charging_armor: 0, texture_asset_id: null }
const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const entityPath = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const java = (files: Record<string, string | Uint8Array>) => String(files[entityPath])
const refused = (change: Record<string, unknown>) => BossSchema.safeParse({ ...boss, ...change }).error?.issues.map((issue) => issue.message).join(" ") ?? ""

test("站定回差按阶段保存，稳重的两种走位入口都可走完已有路线", () => {
  const between = { style: "circle", distance: 6, pause: 0, stand_distance: 4 }
  const phases = boss.phases.map((phase, index) => ({
    ...phase, between: index === 0 ? { ...between, stand_resume: 10 } : between,
  }))
  const shape = { ...plain, engagement: "any_player", abilities: felt2, boss: { ...boss, phases }, tactics: { between } }
  const original = java(compileEntity(shape))
  expect(original).toContain("TACTICS_RESUME = {4.0, 10.0, 4.0}")
  expect(original).not.toContain("steadyFollowingPath")
  for (const data of [shape, { ...shape, runtime }]) {
    const source = java(compileEntity({ ...data, steady: { preset: "huge" } }))
    expect(source).toContain("TACTICS_RESUME = {7.0, 10.0, 7.0}")
    expect(source).toContain("|| steadyFollowingPath();")
  }
})

test("each phase plays its sound once in bossChange", () => {
  const asset = "11111111-1111-4111-8111-111111111111"
  const phases = boss.phases.map((phase, index) => ({ ...phase, sound: index ? { asset } : "entity.iron_golem.attack" }))
  const changed = BossSchema.parse({ ...boss, phases })
  const source = java(compileEntity({ ...plain, abilities: felt2, boss: changed, customSounds: { [asset]: { name: "bronze_bell", category: "ambient" } } }))
  const change = source.split("void bossChange(int phase)")[1]!.split("\n    }")[0]!
  expect(change).toContain("if (phase == 1) level().playSound")
  expect(change).toContain("SoundEvents.IRON_GOLEM_ATTACK")
  expect(change).toContain("if (phase == 2) level().playSound")
  expect(change).toContain("BRONZE_BELL")
  expect(change).toContain("SoundSource.AMBIENT")
  expect(refused({ phases: [{ ...phases[0], sound: "unknown" }] })).toContain("换阶段")
})

test("a repeated sound samples within its pitch variation at playback", () => {
  const event = { type: "sound", at: 0.1, sound: "entity.iron_golem.attack", volume: 1, pitch: 1, pitch_variation: 0.1 }
  const ability = AbilitySchema.parse({ ...slam, events: [event] })
  expect(java(compileEntity({ ...plain, abilities: [ability] }))).toContain("(getRandom().nextFloat() * 2.0f - 1.0f) * 0.1f")
  expect(AbilitySchema.safeParse({ ...slam, events: [{ ...event, pitch_variation: 0.51 }] }).error?.issues[0]?.message).toContain("浮动")
})

test("an opening sound reaches its final pitch on the windup tick", () => {
  const event = { type: "sound", at: 0, sound: "entity.iron_golem.attack", volume: 1, pitch: 0.8, pitch_to: 1.4 }
  const ability = AbilitySchema.parse({ ...slam, events: [event] })
  expect(java(compileEntity({ ...plain, abilities: [ability] }))).toContain("(1.4f - 0.8f) * (tick - 0)")
  expect(AbilitySchema.safeParse({ ...slam, events: [{ ...event, at: slam.windup }] }).success).toBe(false)
})

test("a wall stops all consequences of a blocked area strike", () => {
  const ability = AbilitySchema.parse({ ...slam, hits: slam.hits.map(hit => hit.type === "area" ? { ...hit, blocked_by_walls: true } : hit) })
  const source = java(compileEntity({ ...plain, abilities: [ability] }))
  expect(source).toContain("ClipContext.Block.COLLIDER")
  expect(source).toContain("if (!abilityClear(")
})

// ---- the data ----

test("a creature without a boss is what it was; a boss is bounded and says what is wrong in plain words", () => {
  const old = { id: "11111111-1111-4111-8111-111111111111", name: "苔皮苦力怕", description: "", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile", model_asset_id: null }
  expect(JSON.stringify(EntitySchema.parse(old))).toBe(JSON.stringify(old))
  expect(EntitySchema.parse({ ...old, abilities: felt2, boss }).boss?.phases).toHaveLength(2)
  expect(refused({})).toBe("")
  expect(refused({ intro: { ...boss.intro, wake_distance: 3 } })).not.toBe("")
  expect(refused({ intro: { ...boss.intro, wake_distance: 33 } })).not.toBe("")
  expect(refused({ intro: { ...boss.intro, seconds: 0.4 } })).not.toBe("")
  expect(refused({ phases: Array.from({ length: BOSS_LIMITS.phases + 1 }, (_, index) => ({ ...boss.phases[0]!, below: 0.9 - index * 0.2 })) })).not.toBe("")
  expect(refused({ phases: [{ ...boss.phases[0]!, speed: 2.5 }] })).not.toBe("")
  expect(refused({ phases: [{ ...boss.phases[0]!, damage: 3.5 }] })).not.toBe("")
  expect(refused({ phases: [{ ...boss.phases[0]!, below: 0.96 }] })).not.toBe("")
  expect(refused({ death: { ...boss.death, xp_bursts: BOSS_LIMITS.bursts + 1 } })).not.toBe("")
  expect(refused({ leash: { distance: 15, reset_seconds: 30 } })).not.toBe("")
  expect(refused({ leash: { distance: 48, reset_seconds: 121 } })).not.toBe("")
  expect(refused({ intro: { ...boss.intro, sound: "entity.dragon.made_up" } })).not.toBe("")
  // Its document as a whole: only a hostile creature, the lines of life from high to low, motions that are not the plain ones, phases that name abilities that exist.
  const document = (change: Record<string, unknown>) => EntitySchema.safeParse({ ...old, abilities: felt2, boss, ...change }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  expect(document({})).toBe("")
  expect(document({ behavior: "passive" })).toContain("只有敌对的生物（behavior 写 hostile）能当 Boss")
  expect(document({ boss: { ...boss, phases: [boss.phases[1]!, boss.phases[0]!] } })).toContain("从大到小")
  expect(document({ boss: { ...boss, intro: { ...boss.intro, clip: "walk" } } })).toContain("walk")
  expect(document({ boss: { ...boss, phases: [{ ...boss.phases[0]!, abilities: ["nothing"] }] } })).toContain("nothing")
  // Shake and debris events are bounded as well.
  const event = (change: Record<string, unknown>) => AbilitySchema.safeParse({ ...slam, events: [{ ...shake, ...change }] }).success
  // Boss 能力 8: strength now reaches 8 (it was 3), with roll, fov, falloff and frequency bounded too.
  expect([event({}), event({ strength: 0.1 }), event({ strength: 3.1 }), event({ strength: 8.1 }), event({ radius: 3 }), event({ radius: 49 }), event({ seconds: 0.05 }), event({ seconds: 3.5 })]).toEqual([true, false, true, false, false, false, false, false])
  expect([event({ roll: 10 }), event({ roll: 10.5 }), event({ fov: -10 }), event({ fov: 11 }), event({ falloff: "none" }), event({ falloff: "square" }), event({ frequency: 0.25 }), event({ frequency: 5 })]).toEqual([true, false, true, false, true, false, true, false])
  const place = (change: Record<string, unknown>) => AbilitySchema.safeParse({ ...slam, events: [{ ...debris, ...change }] }).success
  expect([place({}), place({ radius: 0.5 }), place({ radius: 9 }), place({ count: 0 }), place({ count: 25 }), place({ where: "hit", hit: null }), place({ where: "hit", hit: 0 })]).toEqual([true, false, false, false, false, false, true])
  // A late shake is as wrong as a late sound.
  expect(AbilitySchema.safeParse({ ...slam, events: [{ ...shake, at: slam.length + 0.5 }] }).error?.issues[0]?.message).toContain("晃屏")
})

// ---- ticks and words ----

test("the plan turns seconds into server ticks once, and the masks say which abilities a phase may start", () => {
  const plan = bossPlan(boss, felt2)
  expect(plan).toMatchObject({ introTicks: 16, deathTicks: 80, leashTicks: 600, phases: [{ below: 0.66, ticks: 20, speed: 1.15, damage: 1.3 }, { below: 0.33, ticks: 20, speed: 1.3, damage: 1.6 }] })
  expect(plan.bursts).toHaveLength(6)
  expect(plan.bursts.every((tick, index) => tick >= 1 && tick < 80 && (index === 0 || tick >= plan.bursts[index - 1]!))).toBe(true)
  // The first phase uses what no phase lists (here: burst), the one that lists "slam" has it, the one that lists nothing has everything.
  expect(bossMasks(boss, felt2)).toEqual([0b10, 0b01, 0b11])
  expect(bossMasks({ phases: [] }, felt2)).toEqual([0b11])
  expect(bossMasks({ phases: [{ ...boss.phases[0]!, abilities: ["slam", "burst"] }] }, felt2)).toEqual([0b11, 0b11])
  expect(bossPlan({ ...boss, intro: null, leash: null }, felt2)).toMatchObject({ introTicks: 0, leashTicks: 0 })
})

test("the words say what the boss does in the plain way the spec does", () => {
  const abilities = felt2.map((ability) => ({ id: ability.id, name: ability.name }))
  expect(bossWords.bar(boss)).toBe("血条是紫色、分 10 格的，战斗时天色会暗下来")
  expect(bossWords.intro(boss)).toContain("玩家走近 16 格才醒")
  expect(bossWords.phase(boss.phases[0]!, abilities)).toContain("血量掉到 66% 时变身")
  expect(bossWords.phase(boss.phases[0]!, abilities)).toContain("速度 ×1.15、伤害 ×1.3")
  expect(bossWords.phase(boss.phases[0]!, abilities)).toContain("「重锤」")
  expect(bossWords.death(boss)).toContain("经验分 6 次喷出")
  expect(bossWords.leash(boss)).toContain("离出生点超过 48 格")
  // epic r1 review: the fight ends when nobody is near for the reset time, wherever it stands; the distance only says whether it is also brought home.
  expect(bossWords.leash(boss)).toStartWith("30 秒里 32 格内没有玩家，它血量回满、阶段回到第一阶段")
  expect(bossWords.shake(shake)).toContain("屏幕晃动")
  expect(bossWords.debris(debris)).toContain("只是看得见，不改世界里的方块")
  // With phases it also says what the first phase may start, worked out, so the reviewer does not have to (phase rules, 2026-11-14).
  expect(bossWords.summary(boss, abilities, "\n").split("\n")).toHaveLength(7)
  expect(bossWords.summary(boss, abilities, "\n").split("\n")[2]).toBe("第一阶段（血量掉到第一条线之前）用的招式：「晶刺喷射」")
  // What an AI is told: the fields, the limits and an example the schema takes.
  ;["bar", "intro", "phases", "death", "leash", "0.66", "一刀打不穿两个阶段", "lair 在世界生成的时候铺平台", "打碎方块（break）或临时换块（block_swap）", "summon（可选"].forEach((word) => expect(BOSS_INSTRUCTIONS).toContain(word))
  expect(BOSS_SUMMARY).toContain("Boss")
  const example = /例：(\{"bar".*\})。$/.exec(BOSS_INSTRUCTIONS)?.[1]
  expect(BossSchema.safeParse(JSON.parse(example!)).success).toBe(true)
  expect(ABILITY_INSTRUCTIONS).toContain(BOSS_EVENT_INSTRUCTIONS)
  expect(ABILITY_INSTRUCTIONS).not.toContain("按血量换阶段、召唤")
  expect(creatureBindings({ abilities: felt2 }, fightingGolemDesign.animations).abilities).toHaveLength(2)
})

// ---- against the model ----

test("a boss is held against its model: a motion it lacks stops the build, a motion of the wrong length only warns", () => {
  const clips = fightingGolemDesign.animations.map((clip) => ({ name: clip.name, length: clip.length }))
  const issues = (change: Partial<Boss>, abilities: Ability[] = felt2, model: typeof clips | null = clips) => bossModelIssues({ name: "傀儡", behavior: "hostile", abilities, boss: { ...boss, ...change } }, model)
  expect(issues({})).toEqual([])
  expect(issues({ phases: [{ ...boss.phases[0]!, seconds: 2 }] })).toMatchObject([{ rule: "boss_clip_length", stops: false, text: expect.stringContaining("长 1 秒") }])
  expect(issues({ intro: { ...boss.intro!, clip: "awaken" } })).toMatchObject([{ rule: "boss_clip", stops: true, text: expect.stringContaining("模型里没有这个动作") }, { rule: "boss_clip_length" }].slice(0, 1))
  expect(issues({ phases: [{ ...boss.phases[0]!, abilities: ["nothing"] }] }).some((issue) => issue.rule === "boss_ability" && issue.stops)).toBe(true)
  expect(issues({}, felt2, clips.filter((clip) => clip.name !== "death")).map((issue) => issue.rule)).toContain("boss_death_clip")
  expect(bossModelIssues({ name: "傀儡", behavior: "passive", abilities: felt2, boss }, clips).map((issue) => issue.rule)).toContain("boss_unused")
  expect(bossModelIssues({ name: "傀儡", behavior: "hostile", abilities: felt2, boss: null }, clips)).toEqual([])
  expect(issues({}, felt2, null).filter((issue) => issue.stops)).toEqual([])
})

test("the Boss tier asks for a boss and an ability that is felt, and says only what the schema also requires", async () => {
  const { CREATURE_TIERS, tierAskGaps } = await import("../src/creature-tier")
  const row = CREATURE_TIERS.boss
  const said = (creature: Parameters<typeof tierAskGaps>[1]) => tierAskGaps(row, { steady: { preset: "auto" }, ...creature }).map((gap) => gap.said)
  expect(said({ behavior: "hostile", abilities: felt2, boss })).toEqual([])
  expect(said({ behavior: "hostile", abilities: felt2, boss: null })).toEqual(["还没有 Boss 设置（血条和死亡演出）"])
  // The schema allows no phase at all (0 to 3), the wake-up and the leash may be null: none of them is missing.
  expect(BossSchema.safeParse({ ...boss, phases: [], intro: null, leash: null }).success).toBe(true)
  expect(said({ behavior: "hostile", abilities: felt2, boss: { ...boss, phases: [], intro: null, leash: null } })).toEqual([])
  expect(said({ behavior: "hostile", abilities: [slam, burst], boss })).toEqual(["没有一个招式在落地或吼叫时晃屏或扬起碎块"])
  expect(said({ behavior: "hostile", abilities: [], boss: null })).toHaveLength(2)
  // A creature that does not fight cannot have any of it.
  expect(said({ behavior: "passive", abilities: [], boss: null })).toEqual([])
  expect(felt([slam, burst])).toBe(false)
  expect(felt(felt2)).toBe(true)
})

// ---- the Java ----

test("a boss writes its bar, wake-up, phases, death and leash; a creature without one is not touched", () => {
  const plainFiles = compileEntity({ ...plain, abilities: [slam, burst] })
  expect(java(plainFiles).toLowerCase().includes("boss")).toBe(false)
  expect(java(plainFiles).includes("StudioShake")).toBe(false)
  // A creature that is not a boss may still shake the screen and throw up the ground: only those two calls are added.
  const felty = java(compileEntity({ ...plain, abilities: felt2 }))
  expect(felty.includes("abilityShake(2.0f, 16.0f, 20)") && felty.includes("StudioShake.send(") && !felty.toLowerCase().includes("bossbar")).toBe(true)
  const files = compileEntity({ ...plain, abilities: felt2, boss })
  const source = java(files)
  ;["ServerBossEvent", "BossEvent.BossBarColor.PURPLE", "BossEvent.BossBarOverlay.NOTCHED_10", "BossEvent.BossBarColor.RED", "isImmobile()", "isInvulnerableTo(DamageSource source)", "actuallyHurt(DamageSource source, float amount)", "tickDeath()", "dropExperience(Entity attacker)", "startSeenByPlayer", "stopSeenByPlayer", "BOSS_WAKE_TICKS = 16", "BOSS_DEATH_TICKS = 80", "BOSS_LEASH_TICKS = 600", "BOSS_BELOW = {0.66, 0.33}", "BOSS_MASKS = {2, 1, 3}", "bossAllows(index)", "builder.define(BOSS, BOSS_START)", "abilityShake(2.0f, 16.0f, 20)", `${BOSS_RUNTIME.debris}.burst(`].forEach((word) => expect(source).toContain(word))
  // The game's own removal is not replaced: the bar goes when the game stops telling a player about it.
  expect(source).not.toContain("void remove(")
  // Nothing without a wake-up, a leash or a darkening sky is written for them.
  const bare = java(compileEntity({ ...plain, abilities: felt2, boss: { ...boss, intro: null, leash: null, phases: [], death: { seconds: 2, xp_bursts: 0, explosion: false }, bar: { ...boss.bar, darken_sky: false } } }))
  expect(bare).not.toContain("bossWake")
  expect(bare).not.toContain("BOSS_LEASH")
  expect(bare).not.toContain("setDarkenScreen(bossCombat")
  expect(bare).not.toContain("dropExperience")
  expect(bare).toContain("BOSS_START = BOSS_FIGHT")
  // A boss with an explosion gets its saved numbers inside the explosion's own save methods, once.
  const exploding = java(compileEntity({ ...plain, abilities: felt2, boss, runtime: { ...runtime, explosion: { fuse_ticks: 30, radius: 3, damage_blocks: false, effects: [] } } }))
  expect(exploding.match(/void addAdditionalSaveData/g)).toHaveLength(1)
  expect(exploding).toContain('nbt.putInt("BossState"')
  // It waits for nobody to go, and a boss with a wake-up is never taken away by the world.
  expect(compileEntity({ ...plain, abilities: felt2, boss, runtime: { ...runtime, spawn: { biomes: ["minecraft:plains"], light: "dark", weight: 5, min: 1, max: 1 } } })[entityPath]).toContain("requiresCustomPersistence")
  // Its death is its own (`tickDeath` once, not the clip-timed one).
  expect(source.match(/void tickDeath/g)).toHaveLength(1)
  expect(source).not.toContain("DEATH_TICKS = 32")
  // A boss that is not hostile is not built as one.
  expect(java(compileEntity({ ...plain, behavior: "passive", boss }))).not.toContain("ServerBossEvent")
})

test("a boss whose motion the model lacks is refused in plain words", () => {
  const lost = { ...boss, intro: { ...boss.intro!, clip: "awaken" } }
  expect(() => compileEntity({ ...plain, abilities: felt2, boss: lost })).toThrow("模型里没有这个动作")
})

test("the shake and the pieces of the ground are written once for the project, in the game's own terms", () => {
  const both = compileBossRuntime({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", shake: true, debris: true })
  const base = "src/main/java/com/minemods/content_golem_mod"
  expect(Object.keys(both.files).sort()).toEqual([`${base}/client/${BOSS_RUNTIME.shakeClient}.java`, `${base}/entity/${BOSS_RUNTIME.debris}.java`, `${base}/entity/${BOSS_RUNTIME.shake}.java`, `${base}/mixin/${BOSS_RUNTIME.mixin}.java`].sort())
  const packet = String(both.files[`${base}/entity/${BOSS_RUNTIME.shake}.java`])
  ;["PayloadTypeRegistry.playS2C()", "StreamCodec.composite", "ServerPlayNetworking.canSend"].forEach((word) => expect(packet).toContain(word))
  const client = String(both.files[`${base}/client/${BOSS_RUNTIME.shakeClient}.java`])
  expect(client).toContain("screenEffectScale().get()")
  // A project whose shakes are written as before keeps the cap it always had (Boss 能力 8 raised the cap only for the longer shake).
  expect(client).toContain(`Math.min(sum, ${SHAKE_LIMITS.legacyCap}.0)`)
  const mixin = String(both.files[`${base}/mixin/${BOSS_RUNTIME.mixin}.java`])
  expect(mixin).toContain("@Mixin(Camera.class)")
  expect(mixin).toContain('@Inject(method = "setup", at = @At("TAIL"))')
  const pieces = String(both.files[`${base}/entity/${BOSS_RUNTIME.debris}.java`])
  expect(pieces).toContain(`ALIVE = ${DEBRIS_LIMITS.alive}`)
  expect(pieces).toContain("shouldBeSaved() { return false; }")
  expect(pieces).not.toContain("setBlockState(")
  // The entry points and the mixin list that make the game load them.
  const metadata = JSON.parse(both.patch["src/main/resources/fabric.mod.json"]!(JSON.stringify({ entrypoints: { main: ["a.B"], client: ["a.C"] } })))
  expect(metadata.entrypoints).toEqual({ main: ["a.B", "com.minemods.content_golem_mod.entity.StudioShake"], client: ["a.C", "com.minemods.content_golem_mod.client.StudioShakeClient"] })
  expect(JSON.parse(both.patch["src/main/resources/golem_mod.mixins.json"]!(JSON.stringify({ package: "x", mixins: [], client: [] }))).client).toEqual(["StudioShakeCameraMixin"])
  expect(both.classes).toHaveLength(4)
  // Only the half that is used is written.
  const ground = compileBossRuntime({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", shake: false, debris: true })
  expect(Object.keys(ground.files)).toEqual([`${base}/entity/${BOSS_RUNTIME.debris}.java`])
  expect(ground.patch).toEqual({})
})

test.skipIf(!hasTargetJavac(OFFICIAL))("a boss, its screen shake and its thrown-up ground compile against Minecraft 1.21.1 (Mojang's names), GeckoLib and Mixin", async () => {
  const root = await temporary()
  const explosion = { fuse_ticks: 30, radius: 3, damage_blocks: false, effects: [] }
  const spawn = { biomes: ["minecraft:plains"], tags: ["is_forest"], light: "dark" as const, weight: 5, min: 1, max: 1 }
  const shapes = [
    { classSuffix: "", abilities: felt2, boss },
    { classSuffix: "B", abilities: felt2, boss, runtime },
    { classSuffix: "C", abilities: felt2, boss, runtime: { ...runtime, explosion, spawn }, sounds: { ambient: "block.amethyst_block.chime", hurt: "entity.iron_golem.hurt", death: "entity.iron_golem.death", step: "entity.iron_golem.step", pitch: 1, volume: 1 }, experience: 20 },
    { classSuffix: "D", boss: { ...boss, intro: null, leash: null, phases: [], death: { seconds: 2, xp_bursts: 0, explosion: false }, bar: { ...boss.bar, darken_sky: false } } },
    { classSuffix: "E", abilities: felt2, boss: { ...boss, intro: { ...boss.intro!, clip: null, sound: null }, phases: [{ ...boss.phases[0]!, clip: null }] }, engagement: "any_player" as const },
  ]
  await Promise.all(
    shapes.map(async (shape) => {
      const files = compileEntity({ ...plain, ...shape })
      await writeFile(path.join(root, `StudioCreature${shape.classSuffix}.java`), String(files[`src/main/java/com/minemods/content_golem_mod/entity/StudioCreature${shape.classSuffix}.java`]))
    }),
  )
  const support = compileBossRuntime({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", shake: true, debris: true })
  await Promise.all(Object.entries(support.files).map(async ([name, text]) => writeFile(path.join(root, path.basename(name)), String(text))))
  // Every bar colour and style the vocabulary names, and every sound a wake-up may roar, is the game's own constant.
  await writeFile(
    path.join(root, "Vocabulary.java"),
    `import net.minecraft.sounds.SoundEvent; import net.minecraft.sounds.SoundEvents; import net.minecraft.world.BossEvent;
final class Vocabulary {
    static final BossEvent.BossBarColor[] COLORS = { ${BOSS_BAR_COLOR_IDS.map((id) => `BossEvent.BossBarColor.${id.toUpperCase()}`).join(", ")} };
    static final BossEvent.BossBarOverlay[] STYLES = { ${BOSS_BAR_STYLE_IDS.map((id) => `BossEvent.BossBarOverlay.${id.toUpperCase()}`).join(", ")} };
    static final SoundEvent[] SOUNDS = { ${Object.keys(ABILITY_SOUNDS).map((id) => `SoundEvents.${soundConstant(id)}`).join(", ")} };
}
`,
  )
  const compiled = await targetJavac(OFFICIAL, root)
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 180000)

// ---- the build ----

async function bossProject() {
  const root = await temporary()
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const golem = sample.entities[0]!
  const project = await saveProject(directory, { ...sample, entities: [{ ...golem, abilities: EntitySchema.shape.abilities.unwrap().unwrap().parse(felt2), boss }] }, sample.revision)
  const source = path.join(root, "source")
  await mkdir(source)
  return { root, directory, project, source, built: await assembleBuildSource(directory, source, TEMPLATE) }
}

test("a project with a boss builds its runtime, the entry points and the mixin list; one without builds none of it", async () => {
  const made = await bossProject()
  const base = path.join(made.source, "src/main/java/com/minemods/content_azure_sample")
  expect(String(await readFile(path.join(base, `entity/${BOSS_RUNTIME.shake}.java`), "utf8"))).toContain("record Shake")
  expect(await readFile(path.join(base, `mixin/${BOSS_RUNTIME.mixin}.java`), "utf8")).toContain("@Mixin(Camera.class)")
  const metadata = JSON.parse(await readFile(path.join(made.source, "src/main/resources/fabric.mod.json"), "utf8"))
  expect(metadata.entrypoints.main).toContain("com.minemods.content_azure_sample.entity.StudioShake")
  expect(metadata.entrypoints.client).toContain("com.minemods.content_azure_sample.client.StudioShakeClient")
  expect(JSON.parse(await readFile(path.join(made.source, "src/main/resources/azure_sample.mixins.json"), "utf8")).client).toEqual(["StudioShakeCameraMixin"])
  expect(made.built.bossFiles).toEqual([`com/minemods/content_azure_sample/entity/${BOSS_RUNTIME.shake}.class`, `com/minemods/content_azure_sample/client/${BOSS_RUNTIME.shakeClient}.class`, `com/minemods/content_azure_sample/mixin/${BOSS_RUNTIME.mixin}.class`, `com/minemods/content_azure_sample/entity/${BOSS_RUNTIME.debris}.class`])
  // A project like the sample without one: no boss files, the mixin list as the template has it.
  const root = await temporary()
  const directory = path.join(root, "project")
  await createDataGameplaySample(directory, { life: true, abilities: true })
  const source = path.join(root, "source")
  await mkdir(source)
  const plainBuilt = await assembleBuildSource(directory, source, TEMPLATE)
  expect(plainBuilt.bossFiles).toEqual([])
  expect(JSON.parse(await readFile(path.join(source, "src/main/resources/azure_sample.mixins.json"), "utf8")).client).toEqual([])
  expect(JSON.parse(await readFile(path.join(source, "src/main/resources/fabric.mod.json"), "utf8")).entrypoints.main.join()).not.toContain("StudioShake")
})

test.skipIf(!hasTargetJavac(OFFICIAL))("the whole generated tree of a boss project compiles", async () => {
  const made = await bossProject()
  const compiled = (await compileTreeFor(OFFICIAL, made.source))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 180000)

test("the reconciliation says what a Boss-tier creature still lacks, and stops on what could not be played", async () => {
  const made = await bossProject()
  const golem = made.project.entities[0]!
  const names = { animations: { [golem.id]: fightingGolemDesign.animations.map((clip) => clip.name) } }
  const lost = reconcile({ ...made.project, entities: [{ ...golem, boss: { ...boss, intro: { ...boss.intro!, clip: "awaken" } } }] }, names)
  expect(lost.filter((finding) => finding.rule === "boss_clip")).toMatchObject([{ stops: true, about: { kind: "entity", id: golem.id } }])
  const unplayed = reconcile({ ...made.project }, names)
  expect(unplayed.filter((finding) => finding.rule.startsWith("boss_")).every((finding) => !finding.stops)).toBe(true)
  expect(unplayed.filter((finding) => finding.rule === "animation_unplayed").map((finding) => finding.detail).join()).not.toContain("roar")
})

test("the mod guide says how to try the boss, under 「怎么玩一遍」, and says nothing of a boss for a project without one", async () => {
  const made = await bossProject()
  const section = made.built.guide.sections.find((value: { title: string }) => value.title === "怎么玩一遍")
  const lines = (section?.lines ?? []).map((line: { text: string }) => line.text)
  expect(lines.find((line: string) => line.includes("是 Boss"))).toContain("Studio 不会替你把它叫醒")
  expect(lines.find((line: string) => line.includes("第 1 次变身"))).toContain("血量剩 66%")
  expect(lines.find((line: string) => line.includes("第 2 次变身"))).toContain("血量剩 33%")
  expect(lines.find((line: string) => line.includes("晃屏和碎块"))).toContain("屏幕效果强度")
  expect(lines.find((line: string) => line.includes("走远了会回去"))).toContain("48 格")
  // broad7 w3: the leash asks nobody near as well, and a phase says only what it changes.
  expect(lines.find((line: string) => line.includes("走远了会回去"))).toContain("32 格以外")
  // The leash ends a fight wherever the boss is (nobody within the battle range for reset_seconds); the test is walking away from it, and being led beyond the distance is the second try.
  const leashStep = lines.find((line: string) => line.includes("走远了会回去"))!
  expect(leashStep).toContain(`待 ${boss.leash!.reset_seconds} 秒以上`)
  expect(leashStep).toContain("不管它当时在哪里")
  expect(leashStep).toContain("先在它出生点附近打它几下")
  expect(leashStep).not.toContain("把它引出出生点")
  expect(leashStep.indexOf("32 格以外")).toBeLessThan(leashStep.indexOf("48 格"))
  for (const [number, phase] of boss.phases.entries()) {
    const line = lines.find((value: string) => value.includes(`第 ${number + 1} 次变身`))!
    expect(line.includes("走得快到")).toBe(phase.speed > 1)
    expect(line.includes("出手重到")).toBe(phase.damage > 1)
  }
  expect(lines.find((line: string) => line.includes("死的时候"))).toContain("经验分 6 次喷出")
  // broad6 w1: its bare-handed attack of 0 is told apart from its abilities, and a sleeping boss is not said to stand behind a wall.
  const all = made.built.guide.sections.flatMap((value: { lines: { text: string }[] }) => value.lines.map((line) => line.text))
  if (made.project.entities[0]!.attack_damage === 0) expect(all.join("\n")).toContain("它伤人靠下面的招式")
  expect(all.join("\n")).not.toContain("玻璃栏")
  // broad6 w3: a kill the game counts as the player's is how experience is seen.
  expect(all.join("\n")).toContain("minecraft:player_attack by @s")
  const plain = await createDataGameplaySample(path.join(await temporary(), "project"), { life: true, abilities: true })
  expect(JSON.stringify(plain.entities[0]!.boss ?? null)).toBe("null")
})

test("a sleeping boss is set out further away than it wakes, and the scene never wakes it", async () => {
  const { scenePlan } = await import("../src/scene")
  const made = await bossProject()
  const at = (project: Parameters<typeof scenePlan>[0]) => scenePlan(project).things.find((thing) => thing.kind === "creature")!.at
  const sleeping = at(made.project)
  const awake = at({ ...made.project, entities: made.project.entities.map((entity) => ({ ...entity, boss: { ...boss, intro: null } })) })
  // The player stands at the origin: a sleeping boss is further from there than it wakes at (16), one with no wake-up is where creatures always stood.
  expect(Math.hypot(sleeping[0], sleeping[2])).toBeGreaterThan(boss.intro!.wake_distance)
  expect(awake[2]).toBeLessThan(sleeping[2])
  const commands = scenePlan(made.project)
  ;[...commands.place, ...commands.ask, ...commands.close].forEach((step) => expect(step.command).not.toMatch(/BossState/))
  // broad6 w1: the pen's wall stops a creature seeing out, so a sleeping boss has none; one with no wake-up keeps its pen (glass, with its gate).
  expect(commands.place.some((step) => step.command.includes("glass_pane") || step.command.includes("fence_gate"))).toBe(false)
  const penned = scenePlan({ ...made.project, entities: made.project.entities.map((entity) => ({ ...entity, boss: { ...boss, intro: null } })) })
  expect(penned.place.filter((step) => step.command.includes("minecraft:glass_pane"))).toHaveLength(4)
  expect(penned.place.filter((step) => step.command.includes("minecraft:oak_fence_gate"))).toHaveLength(1)
})

test("the Boss tier tells the task what a boss needs and how to choose the numbers; the reconciliation reminds of what is missing", async () => {
  const { tierTaskLines } = await import("../src/creature-tier")
  const entries = [
    { key: "beast_model", kind: "model", title: "兽模型", owner: "beast" },
    { key: "beast", kind: "entity", title: "兽", owner: null, tier: { level: "boss" as const, reason: "你说了 Boss", by: "ai" as const } },
  ]
  const lines = tierTaskLines(entries, "beast").join("\n")
  ;["写 boss（格式见 boss 的说明）：血条（bar）和死亡演出（death）必须有", "晃屏（shake）或碎块（debris）", "0.66 和 0.33", "1.5–3 秒", "1.5–2.5", "0.5–1", "预警"].forEach((word) => expect(lines).toContain(word))
  // The phases are open in the schema (0 to 3), so the task lists them as open and never as a must.
  expect(lines).not.toContain("至少 1 个阶段")
  expect(lines).toContain("（可有可无，没有也不算缺）登场（intro）、阶段（phases，0 到 3 个）")
  // Only the creature's own task is told, and only a Boss: its model's task and every other tier are as they were.
  expect(tierTaskLines(entries, "beast_model").join("\n")).not.toContain("晃屏")
  expect(tierTaskLines([{ ...entries[0]!, owner: "beast" }, { ...entries[1]!, tier: { level: "fine" as const, reason: "x", by: "ai" as const } }], "beast").join("\n")).not.toContain("晃屏")

  const made = await bossProject()
  const golem = made.project.entities[0]!
  const names = { animations: { [golem.id]: fightingGolemDesign.animations.map((clip) => clip.name) } }
  const confirmed = (entity: typeof golem) => ({
    ...made.project,
    entities: [entity],
    blueprint: {
      request: "做一只 Boss", style: { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" }, questions: [], revision: 1, state: "confirmed" as const,
      entries: [
        { key: "beast_model", kind: "model", title: "兽模型", brief: "说明", owner: "beast", needs: [], out_of_scope: null, asset_id: golem.id },
        { key: "beast", kind: "entity", title: "兽", brief: "说明", owner: null, needs: ["beast_model"], out_of_scope: null, asset_id: null, tier: { level: "boss" as const, reason: "你说了 Boss", by: "ai" as const } },
      ],
    },
  }) as unknown as Parameters<typeof reconcile>[0]
  const tierBoss = (entity: typeof golem) => reconcile(confirmed(entity), names).filter((finding) => finding.rule === "tier_boss")
  // A complete boss asks nothing; each lack is said once, never stops the build, and uses the spec's own words.
  expect(tierBoss(golem)).toEqual([])
  const without = tierBoss({ ...golem, boss: null })
  expect(without).toMatchObject([{ rule: "tier_boss", stops: false, about: { kind: "entity", id: golem.id } }])
  expect(without[0]!.text).toContain("Boss 档还缺这几项表现：")
  expect(without[0]!.text).toContain("还没有 Boss 设置（血条和死亡演出）")
  // broad21: it never says the creature "is not" a Boss and never denies what it has.
  expect(without[0]!.text).not.toContain("不是")
  expect(without[0]!.fix).not.toContain("不是蓝图上说好的")
  // This project has gameplay code that is about the creature. It changes nothing in what the tier asks or in how the lack is said: a move that gameplay code does is an ability of the creature's own
  // (a hit of type "gameplay", `ability-gameplay.test.ts`) and is counted like any other; code that merely points at the creature is not a move, and no note is added about it.
  expect(without[0]!.text).toBe("Boss 档还缺这几项表现：还没有 Boss 设置（血条和死亡演出）。")
  const counted = reconcile(confirmed({ ...golem, abilities: [slam] }), names)
  expect(counted.find((finding) => finding.rule === "tier_motions")!.text).toContain("的招式只有 1 个，这一档的敌对生物至少要有 2 个")
  expect(counted.find((finding) => finding.rule === "tier_motions")!.text).not.toContain("自己的设置")
  const alone = { ...confirmed({ ...golem, boss: null }), workspace: { ...made.project.workspace, assets: made.project.workspace.assets.filter((asset) => asset.document.kind !== "gameplay") } } as unknown as Parameters<typeof reconcile>[0]
  expect(reconcile(alone, names).find((finding) => finding.rule === "tier_boss")!.text).toBe(without[0]!.text)
  expect(reconcile({ ...alone, entities: [{ ...golem, abilities: [slam] }] } as never, names).find((finding) => finding.rule === "tier_motions")!.text).toBe(counted.find((finding) => finding.rule === "tier_motions")!.text)
  // No phase, no wake-up, no leash: the schema allows it and the tier does not ask for them, so nothing is said (a veteran asked for two moves and was told after packing that phases were missing).
  expect(tierBoss({ ...golem, boss: { ...boss, phases: [], intro: null, leash: null } })).toEqual([])
  expect(tierBoss({ ...golem, abilities: [slam, burst] })[0]!.text).toBe("Boss 档还缺这几项表现：没有一个招式在落地或吼叫时晃屏或扬起碎块。")
  // Both lacks at once are listed together in the one sentence, and the bar that is there is not denied.
  const both = tierBoss({ ...golem, boss: null, abilities: [slam, burst] })[0]!.text
  expect(both).toBe("Boss 档还缺这几项表现：还没有 Boss 设置（血条和死亡演出）；没有一个招式在落地或吼叫时晃屏或扬起碎块。")
  // Not a Boss tier: nothing is asked.
  const standard = confirmed({ ...golem, boss: null })
  expect(reconcile({ ...standard, blueprint: { ...standard.blueprint!, entries: standard.blueprint!.entries.map((value) => ({ ...value, tier: undefined })) } } as never, names).filter((finding) => finding.rule === "tier_boss")).toEqual([])
})

test("the contract the reviewer reads says what the class does as a boss, only as far as it was read", async () => {
  const { gameplayContract, readGeneratedCreature } = await import("../src/creature-contract")
  const files = compileEntity({ ...plain, abilities: felt2, boss })
  const facts = readGeneratedCreature(java(files), null)
  expect(facts.boss).toMatchObject({ bar: ["PURPLE", "NOTCHED_10"], phases: [0.66, 0.33], intro_ticks: 16, wake_distance: 16, death_ticks: 80, bursts: 6, leash_ticks: 600, leash_distance: 48, clamps: true, immobile: true })
  expect(facts.death_ticks).toBe(80)
  expect(facts.plays).toEqual(expect.arrayContaining([{ clip: "roar", by: "boss" }, { clip: "wave", by: "boss" }]))
  expect(readGeneratedCreature(java(compileEntity({ ...plain, abilities: felt2 })), null).boss).toBeNull()
  const made = await bossProject()
  const uses = made.project.workspace.assets.flatMap((asset) => (asset.document.kind === "gameplay" ? asset.document.uses : []))
  const contract = (await gameplayContract(made.directory, uses)).join("\n")
  expect(contract).toContain("Boss：屏幕上方有名字血条")
  expect(contract).toContain("2 个阶段（血量掉到 66%、33% 时变身，一下打不穿两个阶段）")
  expect(contract).not.toContain("没有读到")
  // The binding list: the motions of the wake-up and of the change are started by the boss.
  const bindings = creatureBindings({ abilities: felt2, boss }, fightingGolemDesign.animations)
  expect(bindings.clips.find((bound) => bound.clip === "roar")!.sources.map((source) => source.by)).toContain("boss")
  expect(bindings.clips.find((bound) => bound.clip === "wave")!.sources.filter((source) => source.by === "boss")).toHaveLength(2)
})

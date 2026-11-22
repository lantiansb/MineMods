import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { CREATURE_LIFE_INSTRUCTIONS, MODEL_CLIP_INSTRUCTIONS, creatureClipFindings, creatureClipNeeds, creatureFacets, creatureLootIssues, creatureWords, gameplayFacets } from "../src/creature-life"
import { CREATURE_LIFE_CAPABILITY } from "../src/creature-capability"
import { DATA_CAPABILITY } from "../src/data-words"
import { CREATURE_LIFE_LIMITS, CreatureLootSchema, EntitySchema } from "../src/entity-runtime"
import { BASELINE_GOALS, compileEntity, creatureLootTable, deathTicks } from "../src/fabric/entity"
import { findingLine, generatedNames, type GameplayDocument } from "../src/gameplay"
import { GAMEPLAY_API_WORDS, staticChecks } from "../src/gameplay-check"
import { checkGameplayReferences } from "../src/gameplay-references"
import { LIFE_ERASERS, scanGameplay } from "../src/gameplay-scan"
import { GAMEPLAY_DISCIPLINE, GAMEPLAY_LIFE_REVIEW, GAMEPLAY_LIFE_WORDS, GAMEPLAY_REVIEWER_INSTRUCTIONS, GAMEPLAY_WRITER_INSTRUCTIONS } from "../src/gameplay-words"
import type { Project } from "../src/project"
import { playedAnimations } from "../src/reconcile"
import { applyWorkspaceAsset, getModuleSchema, type ModuleDocument } from "../src/workspace"
import { MODULES } from "../src/workspace-modules"
import { createDataGameplaySample, golemDesign, golemLife, livingGolemDesign } from "../script/data-gameplay-sample"
import { HAS_GAME_DATA, compileTreeFor, vanillaJson } from "./java-tree"
import { hasTargetJavac, targetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const ORIGINAL = path.join(import.meta.dir, "fixtures", "gameplay", "guarding-original.java")
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const clip = (name: string, length: number) => ({ name, length, loop: name === "idle" || name === "walk", channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] })
const face = "#cc9966"
const model = (...extra: [string, number][]) => ({
  name: "Creature",
  texture_size: 64,
  bones: [{ name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ name: "body", origin: [-2, 0, -2], size: [4, 8, 4], faces: { north: face, east: face, south: face, west: face, up: face, down: face } }] }],
  animations: [clip("idle", 1), clip("walk", 1), clip("hurt", 0.4), ...extra.map(([name, length]) => clip(name, length))],
})
const plain = { modId: "life_mod", packageName: "com.minemods.content_life_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: model() }
const runtime = { spawn: null, explosion: null, movement: "direct" as const, armor: 0, charging_armor: 0, texture_asset_id: null }
const java = (files: Record<string, string | Uint8Array>, name: string) => String(files[`src/main/java/com/minemods/content_life_mod/${name}.java`])

/** The living sample: the golem with loot, experience, wider spawning, death and attack motions, and the corrected guarding gameplay. */
async function living() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-life-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const project = await createDataGameplaySample(directory, { life: true })
  const source = path.join(root, "source")
  await mkdir(source)
  return { root, directory, project, source, built: await assembleBuildSource(directory, source, TEMPLATE) }
}
const document = <Kind extends ModuleDocument["kind"]>(project: Project, kind: Kind) => project.workspace.assets.flatMap((asset) => (asset.document.kind === kind ? [{ asset, document: asset.document as Extract<ModuleDocument, { kind: Kind }> }] : []))[0]!

// ---- the fields ----

test("a creature without the new fields is what it was; the new fields are bounded and say what is wrong in plain words", () => {
  const old = { id: "11111111-1111-4111-8111-111111111111", name: "苔皮苦力怕", description: "", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile", model_asset_id: null, runtime: { ...runtime, spawn: { biomes: ["minecraft:forest"], weight: 10, min: 1, max: 2 } } }
  expect(JSON.stringify(EntitySchema.parse(old))).toBe(JSON.stringify(old))
  const refused = (change: Record<string, unknown>) => EntitySchema.safeParse({ ...old, ...change }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  const drop = { item: "azure_shard", min: 1, max: 2, chance: 1, player_only: false }
  expect(refused({ loot: [drop, { ...drop, item: "minecraft:diamond", chance: 0.1, player_only: true }], experience: 8, stationary: { reason: "它长在地上" } })).toBe("")
  expect(refused({ loot: [{ ...drop, item: "minecraft:blue_diamond" }] })).toContain("Minecraft 1.21.1 里没有 minecraft:blue_diamond 这个物品")
  expect(refused({ loot: [{ ...drop, min: 3 }] })).toContain("掉落数量的上限不能比下限小")
  expect(refused({ loot: [{ ...drop, item: "Azure Shard" }] })).toContain("掉落物写本工程物品或方块的标识符")
  expect(CreatureLootSchema.safeParse({ ...drop, chance: 0 }).success).toBe(false)
  expect(EntitySchema.safeParse({ ...old, experience: 101 }).success).toBe(false)
  expect(EntitySchema.safeParse({ ...old, stationary: { reason: " " } }).success).toBe(false)
  expect(EntitySchema.safeParse({ ...old, loot: Array.from({ length: 9 }, () => drop) }).success).toBe(false)
  const spawn = (change: Record<string, unknown>) => EntitySchema.safeParse({ ...old, runtime: { ...old.runtime, spawn: { ...old.runtime.spawn, ...change } } })
  expect(spawn({ biomes: [], tags: ["is_forest"], light: "bright" }).success).toBe(true)
  expect(spawn({ biomes: [] }).error?.issues[0]?.message).toBe("自然生成至少要写一个群系（biomes）或者一组群系（tags）")
  expect(spawn({ tags: ["is_forest", "is_forest"] }).error?.issues[0]?.message).toBe("同一组群系不要重复写")
  expect(spawn({ tags: ["has_structure/village_plains"] }).success).toBe(false)
  // The asset document carries the same fields.
  const { id, ...fields } = old
  expect(Object.keys(getModuleSchema("entity").parse({ kind: "entity", ...fields, model_asset_id: id, loot: [drop], experience: 5, stationary: null }))).toEqual(expect.arrayContaining(["loot", "experience", "stationary"]))
})

// ---- what is generated ----

test("nothing new is generated until a document or a model asks for it", () => {
  const before = compileEntity(plain)
  expect(compileEntity({ ...plain, loot: null, experience: null, stationary: null, gameplayGoals: false })).toEqual(before)
  expect(compileEntity({ ...plain, loot: [], experience: 0 })).toEqual(before)
  const creature = java(before, "entity/StudioCreature")
  expect(creature).not.toMatch(/ DEATH | ATTACK |boolean doHurtTarget|tickDeath|xpReward|ProjectContent|isDeadOrDying/)
  expect(creature).toContain(`goalSelector.addGoal(${BASELINE_GOALS.swim}, new FloatGoal(this));`)
  expect(creature).toContain(`goalSelector.addGoal(${BASELINE_GOALS.wander}, new WaterAvoidingRandomStrollGoal(this, 1.0));`)
  expect(creature).toContain(`goalSelector.addGoal(${BASELINE_GOALS.look_at_player}, new LookAtPlayerGoal(this, Player.class, 8.0f));`)
  expect(creature).toContain(`goalSelector.addGoal(${BASELINE_GOALS.look_around}, new RandomLookAroundGoal(this));`)
  // The renderer leaves GeckoLib's own red flash and tip-over alone.
  expect(java(before, "client/StudioCreatureRenderer")).not.toMatch(/getDeathMaxRotation|getPackedOverlay|applyRotations|getRenderColor/)
  expect(Object.keys(before).some((name) => name.includes("loot_table"))).toBe(false)
  // A runtime block without the new spawn fields writes the spawn rule it always wrote.
  const spawning = java(compileEntity({ ...plain, runtime: { ...runtime, spawn: { biomes: ["minecraft:forest"], weight: 10, min: 1, max: 2 } } }), "StudioContent")
  expect(spawning).toContain("(type, world, reason, pos, random) -> world.getDifficulty() != Difficulty.PEACEFUL && Monster.isDarkEnoughToSpawn(world, pos, random) && Mob.checkMobSpawnRules(type, world, reason, pos, random));")
  expect(spawning).toContain('        BiomeModifications.addSpawn(BiomeSelectors.includeByKey(\n            ResourceKey.create(Registries.BIOME, ResourceLocation.fromNamespaceAndPath("minecraft", "forest"))\n        ), MobCategory.MONSTER, CREATURE, 10, 1, 2);')
  expect(spawning).not.toContain("TagKey")
})

test("drops are a vanilla-shaped entity loot table, experience is the mob's own, and a stationary creature only loses its roaming", () => {
  const loot = [
    { item: "azure_shard", min: 1, max: 3, chance: 1, player_only: false },
    { item: "minecraft:diamond", min: 1, max: 1, chance: 0.1, player_only: true },
  ]
  const files = compileEntity({ ...plain, loot, experience: 8, stationary: { reason: "它长在地上" } })
  const table = JSON.parse(String(files["src/main/resources/data/life_mod/loot_table/entities/creature.json"]))
  expect(table).toEqual(creatureLootTable("life_mod", "creature", loot))
  expect(table.pools.map((pool: { entries: { name: string }[] }) => pool.entries[0]!.name)).toEqual(["life_mod:azure_shard", "minecraft:diamond"])
  expect(table.pools[0].conditions).toBeUndefined()
  expect(table.pools[1].conditions).toEqual([{ condition: "minecraft:killed_by_player" }, { condition: "minecraft:random_chance", chance: 0.1 }])
  expect(table.pools[1].entries[0].functions[0]).toEqual({ add: false, count: 1, function: "minecraft:set_count" })
  expect(table.random_sequence).toBe("life_mod:entities/creature")
  const creature = java(files, "entity/StudioCreature")
  expect(creature).toContain("{ super(type, world); xpReward = 8; }")
  expect(creature).not.toContain("WaterAvoidingRandomStrollGoal")
  expect(creature).toContain("// Stays where it is on purpose: no roaming.")
  expect(creature).toContain("new LookAtPlayerGoal(this, Player.class, 8.0f)")
  if (!HAS_GAME_DATA) return
  // Field for field what the game's own zombie table uses for a counted drop and for a player-only chance.
  const zombie = vanillaJson("data/minecraft/loot_table/entities/zombie.json") as { type: string; pools: { entries: { functions: Record<string, unknown>[] }[]; conditions?: { condition: string }[] }[] }
  expect(table.type).toBe(zombie.type)
  expect(Object.keys(table.pools[0].entries[0].functions[0]).sort()).toEqual(Object.keys(zombie.pools[0]!.entries[0]!.functions[0]!).sort())
  expect(table.pools[0].entries[0].functions[1]).toEqual(zombie.pools[0]!.entries[0]!.functions[1])
  expect(zombie.pools[1]!.conditions![0]).toEqual(table.pools[1].conditions[0])
})

test("a model's death and attack motions are played: death to its end before the body goes, attack on every swing", () => {
  expect([0.4, 1, 1.6, 9].map(deathTicks)).toEqual([20, 20, 32, 100])
  const files = compileEntity({ ...plain, model: model(["death", 1.6], ["attack", 0.5]), runtime })
  const creature = java(files, "entity/StudioCreature")
  expect(creature).toContain('private static final RawAnimation DEATH = RawAnimation.begin().thenPlayAndHold("animation.creature.death");\n    private static final int DEATH_DURATION = 32;')
  expect(creature).toContain("if (++deathTime >= DEATH_DURATION && !level().isClientSide() && !isRemoved()) {\n            level().broadcastEntityEvent(this, EntityEvent.POOF);\n            remove(RemovalReason.KILLED);")
  expect(creature).toContain('controllers.add(new AnimationController<>(this, "death", 0, state -> isDeadOrDying() ? state.setAndContinue(DEATH) : PlayState.STOP));')
  // Dying takes the body over: no walking, no flinching, no fuse.
  expect(creature).toContain("controllers.add(new PacedController(state -> {\n            walkRate = 1.0;\n            if (isDeadOrDying()) return PlayState.STOP;\n            float amount = state.getLimbSwingAmount();\n            if (amount < MOVING_AMOUNT) return state.setAndContinue(IDLE);")
  expect(creature).toContain("if (isDeadOrDying()) return PlayState.STOP;\n            if (hurtTime > lastHurtTime) {")
  // Moving is the game's own limb amount against what the eye sees move, and the walk is played at the rate the body is carried at (`PACE`).
  expect(creature).toContain("private static final float MOVING_AMOUNT = 0.0207f;")
  expect(creature).toMatch(/private static final double WALK_SPEED = [\d.]+;\n    private static final double WALK_MOST = [\d.]+;\n    private double walkRate = 1\.0;/)
  expect(creature).toContain("if (WALK_SPEED > 0) walkRate = Math.min(amount * 5.0 / WALK_SPEED, WALK_MOST);\n            return state.setAndContinue(WALK);")
  expect(creature).toContain("played += (getAnimationState() == State.RUNNING ? walkRate : 1.0) * Math.max(tick - last, 0);")
  expect(creature).not.toContain("state.isMoving()")
  expect(creature).toContain("if (level().isClientSide() || isDeadOrDying()) return;")
  expect(creature).toContain('@Override public boolean doHurtTarget(Entity target) {\n        // Every swing shows, whoever asked for it: one of its own goals or gameplay code.\n        if (!level().isClientSide()) triggerAnim("attack", "attack");\n        return super.doHurtTarget(target);')
  expect(creature).toContain('new AnimationController<>(this, "attack", 0, state -> PlayState.STOP).triggerableAnim("attack", ATTACK)')
  // The hurt motion still starts in the very frame the hit lands: no blend time on its controller.
  expect(creature).toContain('new AnimationController<>(this, "hurt", 0, state -> {')
  expect(java(files, "client/StudioCreatureRenderer")).toContain("@Override protected float getDeathMaxRotation(StudioCreature creature) { return 0f; }")
  // A death no longer than vanilla's second needs no timing of its own.
  const brief = java(compileEntity({ ...plain, model: model(["death", 0.8]) }), "entity/StudioCreature")
  expect(brief).toContain("DEATH")
  expect(brief).not.toMatch(/tickDeath|DEATH_DURATION|EntityEvent/)
})

test("spawning by biome group and by light is written as selectors and a spawn rule the game compiles", async () => {
  const spawn = (extra: Record<string, unknown>, behavior: "hostile" | "passive" = "hostile") => java(compileEntity({ ...plain, behavior, runtime: { ...runtime, spawn: { biomes: [], weight: 10, min: 1, max: 2, ...extra } } }), "StudioContent")
  expect(spawn({ tags: ["is_overworld"] })).toContain('BiomeModifications.addSpawn(BiomeSelectors.tag(TagKey.create(Registries.BIOME, ResourceLocation.fromNamespaceAndPath("minecraft", "is_overworld"))), MobCategory.MONSTER, CREATURE, 10, 1, 2);')
  expect(spawn({ biomes: ["minecraft:plains"], tags: ["is_forest", "is_hill"] })).toContain('        ).or(BiomeSelectors.tag(TagKey.create(Registries.BIOME, ResourceLocation.fromNamespaceAndPath("minecraft", "is_forest")))).or(BiomeSelectors.tag(TagKey.create(Registries.BIOME, ResourceLocation.fromNamespaceAndPath("minecraft", "is_hill")))), MobCategory.MONSTER')
  expect(spawn({ tags: ["is_forest"], light: "any" })).toContain("-> world.getDifficulty() != Difficulty.PEACEFUL && Mob.checkMobSpawnRules(")
  expect(spawn({ tags: ["is_forest"], light: "bright" }, "passive")).toContain("-> world.getRawBrightness(pos, 0) > 8 && Mob.checkMobSpawnRules(")
  expect(spawn({ tags: ["is_forest"], light: "dark" }, "passive")).toContain("-> Monster.isDarkEnoughToSpawn(world, pos, random) && Mob.checkMobSpawnRules(")
  if (!hasTargetJavac("fabric-1.21.1-official")) return
  // Each variant's own classes, compiled against the game in Mojang's names with Fabric's access already applied.
  const variants = [
    compileEntity({ ...plain, behavior: "passive", model: model(["death", 0.8]), loot: [{ item: "minecraft:bone", min: 0, max: 2, chance: 1, player_only: false }], experience: 3, stationary: { reason: "它长在地上" }, runtime: { ...runtime, spawn: { biomes: [], tags: ["is_forest"], light: "bright", weight: 10, min: 1, max: 2 } } }),
    compileEntity({ ...plain, model: model(["death", 3], ["attack", 0.5]), runtime: { ...runtime, explosion: { fuse_ticks: 30, radius: 3, damage_blocks: false, effects: [] }, spawn: { biomes: ["minecraft:plains"], tags: ["is_nether", "is_end"], light: "any", weight: 10, min: 1, max: 2 } } }),
    compileEntity({ ...plain, model: model(["attack", 0.5]) }),
  ]
  for (const files of variants) {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-life-java-"))
    roots.push(root)
    const folder = path.join(root, "com", "minemods", "content_life_mod")
    await Promise.all(["entity", "client"].map((name) => mkdir(path.join(folder, name), { recursive: true })))
    await Promise.all(
      Object.entries(files)
        .filter(([name]) => name.endsWith(".java"))
        .map(([name, text]) => writeFile(path.join(root, name.slice("src/main/java/".length)), String(text))),
    )
    const compiled = await targetJavac("fabric-1.21.1-official", root)
    expect(compiled.output).not.toContain("error")
    expect(compiled.code).toBe(0)
  }
}, 120000)

// ---- gameplay adds to a creature's life and may not erase it ----

test("the gameplay that left the first real guardian standing still is refused, with what to write instead", async () => {
  const original = await readFile(ORIGINAL, "utf8")
  const found = scanGameplay({ mod_id: "mod_ed9c1bba9a9a", slug: "blueglow_guarding", sources: [{ path: "Main.java", content: original }] })
  expect(found.map((finding) => finding.rule)).toEqual(["erases_life"])
  expect(found[0]).toMatchObject({ file: "Main.java", line: 36 })
  expect(findingLine(found[0]!)).toBe(
    'Main.java 第 36 行：调用了 removeFreeWill：把生物的全部行为清空了。生物平常就会的事（游泳、闲逛、看向玩家、追击）要留着：玩法是在这些之上加行为，不是把它们换掉。用 ProjectContent.addGoal("生物的资产 id", 优先级, mob -> new 你的Goal(mob)) 给它加一个带优先级的 Goal（数字越小越优先：游泳 0、追击 1、闲逛 5、看玩家 6、张望 7；放在 2 到 4 就会压过闲逛、又不挡住游泳）。你的 Goal 不运行的时候，它原来的行为自己会接上。',
  )
  const probe = (body: string) => scanGameplay({ mod_id: "legacy_sample", slug: "box_guard", sources: [{ path: "Probe.java", content: `package com.minemods.content_legacy_sample.gameplay.box_guard;\nfinal class Probe {\n    void run(net.minecraft.world.entity.Mob mob, java.util.List<String> names) {\n${body}\n    }\n}\n` }] }).map((finding) => finding.rule)
  ;[
    "mob.removeFreeWill();",
    "mob . removeAllGoals (goal -> true);",
    "goalSelector.removeAllGoals(goal -> true);",
    "selector.getAvailableGoals().clear();",
    "selector.getAvailableGoals() .removeIf(goal -> true);",
    "mob.getBrain().removeAllBehaviors();",
    "mob.getBrain().clearMemories();",
    "mob.getBrain().stopAll(null, mob);",
    "mob.setNoAi(true);",
  ].forEach((line) => expect([line, probe(line)]).toEqual([line, ["erases_life"]]))
  // Ordinary code that only looks alike is left alone, and so is a word in a comment.
  ;["names.clear();", "mob.setNoAi(false);", "mob.getNavigation().stop();", "// mob.removeFreeWill();", "mob.getBrain().eraseMemory(net.minecraft.world.entity.ai.memory.MemoryModuleType.ATTACK_TARGET);", "goalSelector.removeGoal(null);"].forEach((line) => expect([line, probe(line)]).toEqual([line, []]))
  expect(LIFE_ERASERS).toHaveLength(5)
})

test("whoever writes or reviews gameplay is told the two rules, and the accessor offers the way to add a goal", () => {
  ;[GAMEPLAY_DISCIPLINE, GAMEPLAY_WRITER_INSTRUCTIONS, MODULES.gameplay.instructions].forEach((words) => expect(words).toContain(GAMEPLAY_LIFE_WORDS))
  expect(GAMEPLAY_LIFE_WORDS).toContain("只加不换")
  expect(GAMEPLAY_LIFE_WORDS).toContain("不要每一刻都重新寻路")
  expect(GAMEPLAY_REVIEWER_INSTRUCTIONS).toContain(GAMEPLAY_LIFE_REVIEW)
  expect(GAMEPLAY_API_WORDS.join("")).toContain('ProjectContent.addGoal("资产 id", 优先级, mob -> new 你的Goal(mob))')
  expect(GAMEPLAY_API_WORDS.join("")).toContain(`游泳 ${BASELINE_GOALS.swim}、追击或攻击 ${BASELINE_GOALS.engage}、闲逛 ${BASELINE_GOALS.wander}、看向玩家 ${BASELINE_GOALS.look_at_player}、张望 ${BASELINE_GOALS.look_around}`)
})

test("the corrected guarding gameplay passes the checks, joins the creature's own goals, and the whole mod compiles", async () => {
  const { project, source, built } = await living()
  const guarding = document(project, "gameplay")
  expect(staticChecks(project, guarding.document, guarding.asset.id)).toEqual({ bounds: [], references: [] })
  const sources = guarding.document.sources.map((file) => file.content).join("\n")
  expect(sources).toContain("ProjectContent.targetRule(GUARDIAN, GuardPost::mayFight);")
  expect(sources).toContain("ProjectContent.addGoal(GUARDIAN, 2, ReturnGoal::new);")
  // The fighting is left to the creature: the gameplay neither paths to anybody nor swings.
  expect(sources).not.toMatch(/doHurtTarget|moveTo\(target|setTarget/)
  expect(sources).not.toMatch(/removeFreeWill|removeAllGoals|ServerTickEvents/)
  const folder = `src/main/java/com/minemods/content_${project.mod_id}`
  const read = (name: string) => readFile(path.join(source, name), "utf8")
  const creature = await read(`${folder}/entity/StudioCreature.java`)
  // After its own goals, never instead of them.
  expect(creature).toContain("        goalSelector.addGoal(7, new RandomLookAroundGoal(this));\n        // What this mod's gameplay code adds to this kind of creature, beside the goals above.\n        ProjectContent.applyGoals(this, goalSelector, targetSelector);\n    }")
  expect(creature).toContain(`import com.minemods.content_${project.mod_id}.gameplay.api.ProjectContent;`)
  expect(creature).toContain("new WaterAvoidingRandomStrollGoal(this, 1.0)")
  const accessor = await read(`${folder}/gameplay/api/ProjectContent.java`)
  expect(accessor).toContain("public static void addGoal(String id, int priority, Function<PathfinderMob, Goal> factory) {")
  expect(accessor).toContain("public static void addTargetGoal(String id, int priority, Function<PathfinderMob, Goal> factory) {")
  expect(accessor).toContain("public static void applyGoals(PathfinderMob mob, GoalSelector goals, GoalSelector targets) {")
  // Data of the same creature: its drops, its experience, its wider spawning.
  expect(JSON.parse(await read(`src/main/resources/data/${project.mod_id}/loot_table/entities/${built.entityIds[0]}.json`))).toEqual(creatureLootTable(project.mod_id, built.entityIds[0]!, golemLife.loot))
  expect(creature).toContain(`xpReward = ${golemLife.experience};`)
  expect(await read(`${folder}/StudioContent.java`)).toContain('.or(BiomeSelectors.tag(TagKey.create(Registries.BIOME, ResourceLocation.fromNamespaceAndPath("minecraft", "is_mountain"))))')
  // Gameplay may not put a table of its own in the place of the creature's.
  expect(generatedNames(project).data(`data/${project.mod_id}/loot_table/entities/${built.entityIds[0]}.json`)).toBe(true)
  // Death and attack are played now, so the build no longer calls them unused; the rule's own roar and the idle wave are as before.
  expect(playedAnimations(project, project.entities[0]!.id, livingGolemDesign.animations.map((animation) => animation.name))).toEqual(["idle", "walk", "hurt", "death", "attack", "roar"])
  expect(playedAnimations(project, project.entities[0]!.id, golemDesign.animations.map((animation) => animation.name))).toEqual(["idle", "walk", "hurt", "roar"])
  expect(built.findings.find((finding) => finding.rule === "animation_unplayed")?.detail).toBe("never played: wave; played: idle, walk, hurt, death, attack, roar")
  if (!hasTargetJavac(OFFICIAL)) return
  const compiled = (await compileTreeFor(OFFICIAL, source))!
  expect(compiled.output).not.toContain("error")
  expect(compiled.code).toBe(0)
}, 120000)

test("a goal is added to a creature of this project that the gameplay lists, and to nothing else", async () => {
  const { project } = await living()
  const guarding = document(project, "gameplay")
  const changed = (from: string, to: string, uses = guarding.document.uses): GameplayDocument => ({ ...guarding.document, uses, sources: guarding.document.sources.map((file) => ({ ...file, content: file.content.replace(from, to) })) })
  const rules = (value: GameplayDocument) => checkGameplayReferences(project, value, guarding.asset.id).map((finding) => finding.rule)
  expect(rules(guarding.document)).toEqual([])
  expect(rules(changed(project.entities[0]!.id, "99999999-9999-4999-8999-999999999999"))).toEqual(["unknown_content", "unknown_content"])
  expect(rules(changed("ProjectContent.addGoal(GUARDIAN, 2, ReturnGoal::new)", "ProjectContent.addTargetGoal(GUARDIAN, 3, ReturnGoal::new)"))).toEqual([])
  expect(rules(changed("ProjectContent.addGoal(GUARDIAN, 2, ReturnGoal::new)", "ProjectContent.addGoal(name(), 2, ReturnGoal::new)"))).toEqual(["accessor_argument"])
  expect(rules(changed("", "", guarding.document.uses.slice(1)))).toEqual(["undeclared_use", "undeclared_use"])
  // The priority is a whole number written out, inside the band: over idling (2–4) or after everything (8 and up). Never beside swimming or combat.
  const prioritised = (priority: string, method = "addGoal") => checkGameplayReferences(project, changed("ProjectContent.addGoal(GUARDIAN, 2, ReturnGoal::new)", `ProjectContent.${method}(GUARDIAN, ${priority}, ReturnGoal::new)`), guarding.asset.id)
  ;["2", "3", "4", "8", "20"].forEach((priority) => expect([priority, prioritised(priority)]).toEqual([priority, []]))
  ;["0", "1", "5", "7", "-1", "PRIORITY", "1 + 1", "Math.max(2, 3)"].forEach((priority) => expect([priority, prioritised(priority).map((finding) => finding.rule)]).toEqual([priority, ["goal_priority"]]))
  expect(prioritised("0", "addTargetGoal").map((finding) => finding.rule)).toEqual(["goal_priority"])
  expect(findingLine(prioritised("0")[0]!)).toBe(
    "Main.java 第 14 行：ProjectContent.addGoal(...) 的优先级写的是 0，不在允许的范围里。生物自带的行为按优先级排着（数字越小越优先）：游泳 0、追击或攻击 1、闲逛 5、看向玩家 6、张望 7。玩法加的行为，优先级只能写 2 到 4（排在追击后面、闲逛前面：该它上场时盖过闲逛，但不和游泳、战斗抢），或者 8 及以上（排在所有自带行为后面：闲着没别的事才轮到）。写 0 或 1 会和游泳、追击抢着运行（掉进水里不游、该打的时候站着不动）；写 5 到 7 会和闲逛、张望撞在同一级，谁先开始谁占着。把优先级直接写成 2 到 4 之间的整数（该它上场时要盖过闲逛），或者 8 及以上的整数（只在闲着时做）。",
  )
  expect(findingLine(prioritised("PRIORITY")[0]!)).toContain("的优先级不是直接写出来的整数（写的是 PRIORITY）。写成变量、常量或算式，Studio 没法在不开游戏的情况下核对它不会和生物自带的行为抢。")
  expect(GAMEPLAY_API_WORDS.join("")).toContain("优先级只能写 2 到 4")
  const internal = checkGameplayReferences(project, changed("ProjectContent.addGoal(GUARDIAN, 2, ReturnGoal::new)", "ProjectContent.applyGoals(null, null, null)"), guarding.asset.id)
  expect(internal.map(findingLine)).toEqual(['Main.java 第 14 行：ProjectContent.applyGoals 是 Studio 生成的生物自己调用的，玩法代码不能调用。要给生物加行为，用 ProjectContent.addGoal("生物的资产 id", 优先级, mob -> new 你的Goal(mob))；要管它打谁，用 ProjectContent.targetRule("生物的资产 id", (mob, 候选) -> …)。'])
}, 120000)

// ---- motions follow from behaviour ----

test("the motions a creature needs follow from what it does, and a missing one is said with what the game shows instead", () => {
  const hostile = { name: "守卫", behavior: "hostile" as const, attack_damage: 4, runtime }
  expect(creatureClipNeeds(hostile).map((need) => [need.clip, need.required])).toEqual([["idle", true], ["walk", true], ["hurt", true], ["death", false], ["attack", false]])
  // Nothing swings: a passive one, one that hits for nothing, one that explodes instead.
  ;[{ ...hostile, behavior: "passive" as const }, { ...hostile, attack_damage: 0 }, { ...hostile, runtime: { ...runtime, explosion: { fuse_ticks: 30, radius: 3, damage_blocks: false, effects: [] } } }].forEach((creature) =>
    expect(creatureClipNeeds(creature).map((need) => need.clip)).toEqual(["idle", "walk", "hurt", "death"]),
  )
  expect(creatureClipFindings(hostile, ["idle", "walk", "hurt", "death", "attack"])).toEqual([])
  expect(creatureClipFindings(hostile, ["idle", "walk", "hurt"]).map((finding) => `${finding.text}${finding.fix}`)).toEqual([
    "「守卫」被打死的时候没有自己的动作：只会像原版生物那样变红、侧身倒下，一秒后消失。给它的模型加一个名叫 death 的动作（倒下）。最长 5 秒，播完它才消失。",
    "「守卫」出手打人的时候没有自己的动作：它打人的时候自己身上看不出在出手，只有玩家那边掉血。给它的模型加一个名叫 attack 的动作（攻击）。出手的那一下放在动作开头 0.25 秒以内，伤害是一挥就算的。",
  ])
  // Whoever makes the model and whoever writes the creature's rules read the same derivation.
  expect(MODULES.model.instructions).toContain(MODEL_CLIP_INSTRUCTIONS)
  expect(MODEL_CLIP_INSTRUCTIONS).toContain("由这只生物会做的事决定")
  expect(MODULES.entity.instructions).toContain(CREATURE_LIFE_INSTRUCTIONS)
  ;["stationary={reason}", "loot", "experience", "runtime.spawn", "tags", "light: dark|bright|any"].forEach((word) => expect(CREATURE_LIFE_INSTRUCTIONS).toContain(word))
  // The capability list an outside AI reads says the same things, and what is not there.
  expect(DATA_CAPABILITY.done).toEqual(expect.arrayContaining([...CREATURE_LIFE_CAPABILITY.done]))
  expect(DATA_CAPABILITY.not_done).toEqual(expect.arrayContaining([...CREATURE_LIFE_CAPABILITY.not_done]))
  expect(CREATURE_LIFE_CAPABILITY.done.join("")).toContain(`最长 ${CREATURE_LIFE_LIMITS.death_seconds} 秒`)
})

// ---- the four questions ----

test("a creature answers the four questions from its document, its model and the project around it", async () => {
  const { project } = await living()
  const golem = document(project, "entity").document
  const facets = creatureFacets(golem, project)
  const answer = (list: typeof facets, question: string) => list.filter((facet) => facet.question === question)
  expect(facets.every((facet) => facet.answered)).toBe(true)
  expect(answer(facets, "source")).toEqual([{ question: "source", answered: true, words: "会自己出现在这些群系：溶洞、平原、山地一类的群系、森林一类的群系，一次 1–2 只；只在暗处出现，和平难度下不出现", through: [] }])
  expect(answer(facets, "use")[0]!.words).toBe("打败它会掉 1–3 个「蓝晶碎片」；10% 的机会掉 1 个「钻石」（要玩家亲手打败）；给 8 点经验")
  expect(answer(facets, "reaction")[0]).toMatchObject({ words: "被打会变红、被打退，被打有自己的动作、被打死有自己的动作、出手打人有自己的动作；玩法「晶石傀儡守矿」的代码给它设了打谁的规则，实际打谁以那个玩法为准", detail: expect.stringContaining("动作 wave：没有任何地方会播放它\n动作 death：死的时候播，播完才消失［controller \"death\"］\n动作 attack：每次出手（doHurtTarget）时播") })
  expect(answer(facets, "idle")[0]!.words).toBe("没事的时候自己四处走动、张望，看向走近的玩家，掉进水里会游")
  expect(facets.every((facet) => facet.words.length <= 160)).toBe(true)
  // Without a spawn rule it is egg-only; without drops nothing comes of beating it; a standstill without a reason is open. A missing
  // death or swing motion is not: the game shows its own fall and hit, and that is said as part of the answer (broad1: the build
  // called it an open question after the plan had been checked as playable).
  const bare = creatureFacets({ ...golem, runtime: { ...golem.runtime, spawn: null }, loot: null, experience: null, speed: 0 }, { ...project, workspace: { assets: project.workspace.assets.map((asset) => (asset.document.kind === "model" ? { ...asset, document: { ...asset.document, animations: asset.document.animations.filter((animation) => !["death", "attack"].includes(animation.name)) } } : asset)).filter((asset) => asset.document.kind !== "gameplay") } })
  expect(bare.map((facet) => [facet.question, facet.answered])).toEqual([["source", false], ["use", false], ["reaction", true], ["idle", false]])
  expect(bare.map((facet) => facet.words)).toEqual([
    "不会自己出现：只能用它的刷怪蛋或者指令放出来，生存模式的玩家遇不到它",
    "打败它什么都不掉，也不给经验",
    "被打会变红、被打退，被打有自己的动作；被打死的时候没有自己的动作：只会像原版生物那样变红、侧身倒下，一秒后消失；出手打人的时候没有自己的动作：它打人的时候自己身上看不出在出手，只有玩家那边掉血",
    "移动速度是 0，走不了：它只会原地转头，却没有说明为什么不动",
  ])
  // broad6 w4b: a rule that has it follow a player holding bread is something it is for, though it drops nothing.
  const led = creatureFacets({ ...golem, loot: null, experience: null }, { ...project, logic: [{ id: "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", entity_id: golem.model_asset_id, trigger: "holding_item", action: "follow", item: "minecraft:bread", enabled: true }] })
  expect(led.find((facet) => facet.question === "use")).toMatchObject({ answered: true, words: "拿着「面包」它会跟着你走" })
  const off = creatureFacets({ ...golem, loot: null, experience: null }, { ...project, logic: [{ id: "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", entity_id: golem.model_asset_id, trigger: "holding_item", action: "follow", item: "minecraft:bread", enabled: false }] })
  expect(off.find((facet) => facet.question === "use")).toMatchObject({ answered: false })
  expect(creatureFacets({ ...golem, stationary: { reason: "它被锁在矿脉上" } }, project).find((facet) => facet.question === "idle")).toEqual({ question: "idle", answered: true, words: "故意不走动（它被锁在矿脉上）；会转头看走近的玩家，一直做待机动作" })
  // A creature that stays where it is is not knocked off its place (its knockback resistance is full), and its words say so.
  const rooted = creatureFacets({ ...golem, speed: 0, stationary: { reason: "它被锁在矿脉上" } }, project)
  expect(rooted.find((facet) => facet.question === "reaction")!.words).toContain("被打会变红、不会被打退（它守着原地）")
  expect(rooted.find((facet) => facet.question === "reaction")!.words).not.toContain("、被打退")
  expect(rooted.every((facet) => facet.answered)).toBe(true)
  expect(rooted.every((facet) => facet.words.length <= 170)).toBe(true)
  // Gameplay code that reads the creature's type and spawns it is a source of its own.
  const guarding = document(project, "gameplay")
  const summoning = { ...project, workspace: { assets: project.workspace.assets.map((asset) => (asset.id === guarding.asset.id ? { ...asset, document: { ...guarding.document, sources: [...guarding.document.sources, { path: "Summon.java", content: `class Summon { void run(net.minecraft.server.world.ServerWorld world) { ProjectContent.entity("${golem.model_asset_id}").spawn(world, null, null); } }` }] } } : asset)) } }
  expect(creatureFacets({ ...golem, runtime: { ...golem.runtime, spawn: null } }, summoning).filter((facet) => facet.question === "source")).toEqual([{ question: "source", answered: true, words: "玩法「晶石傀儡守矿」的代码会把它放进世界（什么时候放，见那个玩法的说明）", through: [guarding.asset.id] }])
  expect(creatureWords.spawn({ biomes: [], tags: ["is_overworld"], light: "bright", weight: 10, min: 2, max: 4 }, "passive")).toBe("会自己出现在这些群系：整个主世界，一次 2–4 只；只在亮处出现")
  // The registry hands both readers to the standard.
  expect(MODULES.entity.facets).toBe(creatureFacets)
  expect(MODULES.gameplay.facets).toBe(gameplayFacets)
  const play = gameplayFacets(guarding.document, project)
  expect(play.map((facet) => facet.question)).toEqual(["source", "use", "reaction", "reaction", "reaction"])
  expect(play[1]!.words).toStartWith("挂在「晶石傀儡」、「蓝晶矿石」上：")
}, 120000)

test("a drop has to name something of the project before the creature is saved or built", async () => {
  const { project, directory, root } = await living()
  const entity = project.workspace.assets.find((asset) => asset.document.kind === "entity")!
  const lost = { ...entity, document: { ...entity.document, loot: [{ item: "blue_sword", min: 1, max: 1, chance: 1, player_only: false }] } }
  expect(creatureLootIssues(project, { name: "晶石傀儡", loot: [{ item: "blue_sword", min: 1, max: 1, chance: 1, player_only: false }, { item: "azure_ore", min: 1, max: 1, chance: 1, player_only: false }, { item: "minecraft:bone", min: 1, max: 1, chance: 1, player_only: false }] })).toEqual(["生物「晶石傀儡」的掉落物「blue_sword」在这个工程里找不到。先把这样物品或方块做出来，或者写成 minecraft:名字 的原版物品。"])
  expect(() => applyWorkspaceAsset(project, lost as typeof entity)).toThrow("生物「晶石傀儡」的掉落物「blue_sword」在这个工程里找不到。")
  // A project file edited by hand does not get past the build either.
  const file = path.join(directory, "minemods.project.json")
  const saved = JSON.parse(await readFile(file, "utf8"))
  saved.entities[0].loot = [{ item: "blue_sword", min: 1, max: 1, chance: 1, player_only: false }]
  await writeFile(file, JSON.stringify(saved))
  const source = path.join(root, "again")
  await mkdir(source)
  await expect(assembleBuildSource(directory, source, TEMPLATE)).rejects.toThrow(`ENTITY_LOOT_UNKNOWN_ITEM:${project.entities[0]!.id}`)
}, 120000)

test("被放进世界的生物留在世界里：只有会自然出现的敌对生物才像原版怪物那样被清掉", () => {
  const stays = "@Override public boolean requiresCustomPersistence() { return true; }"
  const forest = { biomes: ["minecraft:forest"], weight: 10, min: 1, max: 2 }
  const made = (shape: Record<string, unknown>) => java(compileEntity({ ...plain, ...shape }), "entity/StudioCreature")
  // Summoned, hatched from an egg or placed by gameplay code (no natural spawn), hostile or not; and every peaceful one: never removed for being far away.
  expect(made({})).toContain(stays)
  expect(made({ runtime })).toContain(stays)
  expect(made({ behavior: "passive", runtime: { ...runtime, spawn: forest } })).toContain(stays)
  // The world keeps bringing these back, so it may take them away: the game's own rule for monsters.
  expect(made({ runtime: { ...runtime, spawn: forest } })).not.toContain("requiresCustomPersistence")
})

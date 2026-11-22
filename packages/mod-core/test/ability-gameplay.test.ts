import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { BuildStop } from "../src/build-stop"
import { assembleBuildSource } from "../src/build-source"
import { ABILITY_INSTRUCTIONS, ABILITY_SUMMARY, abilityPlan, abilityStep, abilityWords, abilityIdle } from "../src/creature-abilities"
import { EntitySchema, AbilitySchema, hitBone, type Ability } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { gameplaySupport } from "../src/fabric/gameplay"
import { GAMEPLAY_API, type GameplayDocument } from "../src/gameplay"
import { GAMEPLAY_API_WORDS, staticChecks } from "../src/gameplay-check"
import { abilityActionGaps, checkGameplayReferences, gameplayBySlug, registeredActions } from "../src/gameplay-references"
import { PLAIN_RULES, RULE_IDS } from "../src/gameplay-plain"
import { GAMEPLAY_DISCIPLINE } from "../src/gameplay-words"
import { gameplayContract } from "../src/creature-contract"
import { saveProject, type Project } from "../src/project"
import { reconcile } from "../src/reconcile"
import { WorkspaceAssetSchema } from "../src/workspace"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

/**
 * An ability whose moment is done by gameplay code is an ability like any other: its name, motion, wait, start window, boss phase, shake and debris are the ability system's. Only what happens at that
 * moment is the gameplay's, through an entry its code registers by name. Counted as a move, held to the same tier, never beside another ability, and a missing gameplay or entry is a failed check.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-ability-gameplay-"))
  roots.push(root)
  return root
}

const [slam] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability, Ability]
const clips = fightingGolemDesign.animations.map((clip) => clip.name)

/** The second move of a swamp boss: the frogs are the gameplay's, the motion ("burst"), the wait, the window and the shake are the ability's. */
const summonJson = {
  id: "summon_frogs",
  name: "召唤小毒蛙",
  clip: "burst",
  windup: 0.8,
  length: 1.6,
  facing: "lock",
  hits: [{ type: "gameplay", at: 1, gameplay: "swamp_summon", action: "summon_frogs" }],
  moves: [],
  start: { min_distance: 3, max_distance: 12, line_of_sight: true, cooldown: 8, weight: 2 },
  stopped_by_hurt: false,
  events: [
    { type: "shake", at: 1, strength: 0.5, radius: 14, seconds: 1 },
    { type: "debris", at: 1, where: "self", hit: null, forward: 0, up: 0, left: 0, radius: 3, count: 8 },
  ],
}
const summon = AbilitySchema.parse(summonJson)

const root = (mod: string) => `com.minemods.content_${mod}.gameplay`
/** What a gameplay writes to answer such a hit: three frogs next to the boss, all after its target. */
const frogs = (mod: string, entry = "summon_frogs") => `package ${root(mod)}.swamp_summon;

import ${root(mod)}.api.GameplayEntry;
import ${root(mod)}.api.ProjectContent;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.animal.frog.Frog;

public final class Main implements GameplayEntry {
    @Override
    public void onInitialize() {
        ProjectContent.abilityAction("${entry}", (creature, target) -> {
            if (!(creature.level() instanceof ServerLevel world)) return;
            for (int index = 0; index < 3; index++) {
                Frog frog = EntityType.FROG.create(world);
                if (frog == null) continue;
                frog.moveTo(creature.getX() + (index - 1) * 1.5, creature.getY(), creature.getZ() + 1.5, creature.getYRot(), 0.0f);
                frog.setTarget(target);
                world.addFreshEntity(frog);
            }
        });
    }
}
`
const gameplayDocument = (mod: string, uses: string[], content: string): GameplayDocument => ({
  kind: "gameplay",
  slug: "swamp_summon",
  name: "沼泽巫祝召唤小毒蛙",
  summary: "沼泽巫祝放出「召唤小毒蛙」这一招的时候，在它身边放出三只小毒蛙，都去打它的目标。",
  behaviours: [{ when: "沼泽巫祝放出「召唤小毒蛙」，动作到位的那一刻", does: "在它身边的地上放出三只小毒蛙，间隔 1.5 格，都以它的目标为目标", shows: "三只小毒蛙从巫祝脚边冒出来，朝玩家跳过去" }],
  not_doing: ["不改变这一招什么时候放、放多久、冷却多长：那些是生物自己的招式管的"],
  uses,
  sources: [{ path: "Main.java", content }],
  data: [],
  lang: { zh_cn: {}, en_us: {} },
})

/** The sample project with the golem as a two-move boss and a gameplay that answers the second move (or does not exist, or does not answer it). */
async function swamp(options: { gameplay?: "answers" | "other_entry" | "none"; abilities?: unknown[] } = {}) {
  const base = await temporary()
  const directory = path.join(base, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const golem = sample.entities[0]!
  const abilities = EntitySchema.shape.abilities.unwrap().unwrap().parse(options.abilities ?? [slam, summonJson])
  const gameplay = options.gameplay ?? "answers"
  const now = new Date().toISOString()
  const document = gameplayDocument(sample.mod_id, [golem.id], frogs(sample.mod_id, gameplay === "other_entry" ? "summon_toads" : "summon_frogs"))
  const withAbilities = sample.workspace.assets.map((asset) => (asset.document.kind === "entity" ? { ...asset, document: { ...asset.document, abilities } } : asset))
  const assets = gameplay === "none" ? withAbilities : [...withAbilities, WorkspaceAssetSchema.parse({ id: crypto.randomUUID(), module: "gameplay", title: document.name, revision: 1, created_at: now, updated_at: now, prompt: "沼泽巫祝召唤小毒蛙", dependencies: [golem.id], document, provenance: { model: "example", request_id: null }, status: "ready" })]
  const project = await saveProject(directory, { ...sample, entities: [{ ...golem, abilities }], workspace: { assets } }, sample.revision)
  return { base, directory, project, golem: project.entities[0]!, document }
}
const names = (project: Project) => ({ animations: { [project.entities[0]!.id]: clips } })

// ---- the data ----

test("an ability may hand a moment to a gameplay: it takes the gameplay's slug and the entry's name, and refuses a spelling or a place that does not fit", () => {
  expect(summon.hits).toEqual([{ type: "gameplay", at: 1, gameplay: "swamp_summon", action: "summon_frogs" }])
  expect(hitBone(summon.hits[0]!)).toBeUndefined()
  // Mixed with the ability system's own hits, in time order.
  const mixed = AbilitySchema.safeParse({ ...summonJson, hits: [{ ...golemAbilities[0]!.hits[0], at: 0.9 }, summonJson.hits[0]] })
  expect(mixed.success).toBe(true)
  const refused = (hit: Record<string, unknown>) => AbilitySchema.safeParse({ ...summonJson, hits: [hit] }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  expect(refused(summonJson.hits[0]!)).toBe("")
  expect(refused({ ...summonJson.hits[0], action: "Summon Frogs" })).toContain("玩法入口的名字用小写字母开头")
  expect(refused({ ...summonJson.hits[0], gameplay: "Swamp" })).toContain("玩法用它的代号（slug）写")
  // Nothing else of the other hits is accepted on it, and both names are needed.
  expect(refused({ ...summonJson.hits[0], damage: 4 })).not.toBe("")
  expect(refused({ type: "gameplay", at: 1, gameplay: "swamp_summon" })).not.toBe("")
  expect(refused({ ...summonJson.hits[0], at: 0.3 })).toContain("不能比蓄力结束（windup）还早")
  expect(refused({ ...summonJson.hits[0], at: 1.7 })).toContain("不能比招式全长（length）还晚")
  // Nothing is laid on a moment that has no place it lands.
  const laid = (event: Record<string, unknown>) => AbilitySchema.safeParse({ ...summonJson, events: [event] }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  expect(laid({ type: "debris", at: 1, where: "hit", hit: 0, forward: 0, up: 0, left: 0, radius: 3, count: 8 })).toContain("是玩法代码做的，没有落点可以对")
  expect(laid({ type: "debris", at: 1, where: "self", hit: null, forward: 0, up: 0, left: 0, radius: 3, count: 8 })).toBe("")
})

// ---- the generated creature ----

const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "沼泽巫祝", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const java = (files: Record<string, string | Uint8Array>) => String(files["src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"])

test("the generated creature calls the gameplay's entry at the tick of the moment, beside the shake and the debris of the same ability", () => {
  const source = java(compileEntity({ ...plain, gameplayGoals: true, abilities: [slam, summon] }))
  // Ability 1 acts on tick 20 (1 s): the entry is called with the creature and the one it is fighting, and the ability's own shake and debris are on the same tick.
  const step = /private void abilityStep1\(int tick\) \{([\s\S]*?)\n    \}/.exec(source)![1]!
  expect(step).toContain("if (tick == 20) {")
  expect(step).toContain('ProjectContent.runAbility("summon_frogs", this, abilityTarget);')
  expect(step).toContain("abilityShake(0.5f, 14.0f, 20);")
  expect(step).toContain("abilityDebris(")
  expect(source).toContain("import com.minemods.content_golem_mod.gameplay.api.ProjectContent;")
  // The first ability is what it was: no call in its step.
  expect(/private void abilityStep0\(int tick\) \{([\s\S]*?)\n    \}/.exec(source)![1]!).not.toContain("runAbility")
  // Without a gameplay hit nothing is called or imported beyond what the creature already had.
  const native = java(compileEntity({ ...plain, abilities: [slam] }))
  expect(native).not.toContain("runAbility")
  expect(native).not.toContain("ProjectContent")
  // With a gameplay hit and no gameplay in the mod, the build says so in words instead of writing a call to a class that is not there.
  try {
    compileEntity({ ...plain, abilities: [slam, summon] })
    throw new Error("should have stopped")
  } catch (error) {
    expect(error).toBeInstanceOf(BuildStop)
    expect((error as Error).message).toContain("交给玩法的代码去做，可是这个工程里没有任何玩法")
  }
})

test("a gameplay's move and a native one take turns: only one runs, the other waits for it to end, and the entry is asked once per run of its own ability", () => {
  const native = AbilitySchema.parse({ ...golemAbilities[0], start: { ...golemAbilities[0]!.start, min_distance: 0, max_distance: 12 } })
  const plans = [native, summon].map((ability) => ({ ...abilityPlan(ability), stopped_by_hurt: ability.stopped_by_hurt }))
  const quiet = { dead: false, target: true, hurt: false }
  // Both are asked to start on the same tick, then again while the first runs: the second never starts beside the first.
  const log: { tick: number; hits: number[]; running: number | null }[] = []
  let run = abilityIdle(2)
  for (let tick = 0; tick < 120; tick++) {
    const stepped = abilityStep(plans, run, { ...quiet, age: 100 + tick, start: tick === 0 ? 0 : tick === 3 || tick === 30 ? 1 : null })
    run = stepped.run
    log.push({ tick, hits: stepped.hits, running: run.running })
  }
  // The native one runs ticks 0 to 24; the other waits, then starts on tick 30 when asked again.
  expect(log.filter((entry) => entry.tick >= 1 && entry.tick < 24).every((entry) => entry.running === 0)).toBe(true)
  expect(log.find((entry) => entry.tick === 3)!.running).toBe(0)
  const summonHits = log.filter((entry) => entry.hits.includes(0) && entry.running !== 0)
  expect(log.some((entry) => entry.running === 1)).toBe(true)
  // The gameplay's hit is the second ability's own hit tick: it started on tick 30, and its moment is 1 s (20 ticks) later.
  expect(log.filter((entry) => entry.running === 1 && entry.hits.length).map((entry) => entry.tick)).toEqual([50])
  expect(summonHits.length).toBeLessThanOrEqual(1)
  // In the generated class the same holds by construction: one index, and a start is refused while it is set.
  const source = java(compileEntity({ ...plain, gameplayGoals: true, abilities: [slam, summon] }))
  expect(source).toContain("if (level().isClientSide() || abilityRunning() || isDeadOrDying() || target == null || !target.isAlive()) return false;")
  expect(source).toContain("case 1 -> abilityStep1(abilityTick);")
  expect((source.match(/runAbility\(/g) ?? []).length).toBe(1)
})

test("the support code the gameplay is written against: an interface for the entry, a registry that refuses a second one and does not let a faulty one take the world down", () => {
  const support = gameplaySupport({ modId: "golem_mod", items: [], blocks: [], creatures: [], gameplays: [] }).files
  const folder = "src/main/java/com/minemods/content_golem_mod/gameplay/api"
  expect(support[`${folder}/AbilityAction.java`]).toContain("void run(Mob creature, LivingEntity target);")
  const content = support[`${folder}/ProjectContent.java`]!
  expect(content).toContain("public static void abilityAction(String name, AbilityAction action) {")
  expect(content).toContain('throw new IllegalArgumentException("The ability action " + name + " is registered twice")')
  expect(content).toContain("public static void runAbility(String name, Mob creature, LivingEntity target) {")
  expect(content).toContain("} catch (RuntimeException | LinkageError error) {")
  // A player's own game never runs it; an entry nobody registered is said once and does nothing.
  expect(content).toContain("if (creature.level().isClientSide()) return;")
  expect(content).toContain("if (ABILITY_SAID.add(name))")
})

// ---- what the checks count and what they refuse ----

/** The blueprint says this creature is a Boss: it asks for at least two moves, a phase and a shake or a piece of debris. */
const boss = (project: Project, abilities: unknown[]) => {
  const golem = project.entities[0]!
  const entity = { ...golem, abilities: EntitySchema.shape.abilities.unwrap().unwrap().parse(abilities), behavior: "hostile" as const }
  return {
    ...project,
    entities: [entity],
    blueprint: {
      request: "做一只 Boss", style: { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "沼泽" }, questions: [], revision: 1, state: "confirmed" as const,
      entries: [
        { key: "witch_model", kind: "model", title: "巫祝模型", brief: "说明", owner: "witch", needs: [], out_of_scope: null, asset_id: golem.id },
        { key: "witch", kind: "entity", title: "巫祝", brief: "说明", owner: null, needs: ["witch_model"], out_of_scope: null, asset_id: null, tier: { level: "boss" as const, reason: "你说了 Boss", by: "ai" as const } },
      ],
    },
  } as unknown as Project
}

test("a move done by gameplay is counted as a move: the Boss tier asks the same two, and is not relaxed for a creature that only has code about it", async () => {
  const made = await swamp()
  const tierMotions = (project: Project) => reconcile(project, names(project)).filter((finding) => finding.rule === "tier_motions")
  // One native move and one handed to the gameplay: two moves, so the count of moves is met and nothing is said about it.
  expect(tierMotions(boss(made.project, [slam, summonJson]))).toEqual([])
  // One move only is still one, whichever kind: the threshold is the same.
  expect(tierMotions(boss(made.project, [summonJson]))[0]!.text).toContain("的招式只有 1 个，这一档的敌对生物至少要有 2 个")
  expect(tierMotions(boss(made.project, [slam]))[0]!.text).toContain("的招式只有 1 个，这一档的敌对生物至少要有 2 个")
  // The shake and the debris of the gameplay's move are felt like any other's.
  const felt = reconcile(boss(made.project, [slam, summonJson]), names(made.project)).filter((finding) => finding.rule === "tier_boss")
  expect(felt.every((finding) => !finding.text.includes("晃屏"))).toBe(true)
  // The note the earlier round added for code that is about the creature is gone for good: nothing is said apart, whatever gameplay is there.
  const all = reconcile(boss(made.project, [slam]), names(made.project))
  expect(all.some((finding) => (finding.rule as string) === "tier_gameplay")).toBe(false)
  expect(all.map((finding) => finding.text).join("")).not.toContain("静态检查认不出来")
})

test("the project says whether each moment handed to a gameplay has something to answer it: counted, found, or a stop in plain words", async () => {
  const answered = await swamp()
  expect(abilityActionGaps(answered.project)).toEqual([])
  expect(reconcile(answered.project, names(answered.project)).filter((finding) => finding.rule === "ability_gameplay")).toEqual([])
  expect(gameplayBySlug(answered.project, "swamp_summon")).toMatchObject({ title: answered.document.name })
  expect(gameplayBySlug(answered.project, "nobody")).toBeNull()
  expect(registeredActions(answered.document.sources)).toMatchObject([{ name: "summon_frogs", file: "Main.java" }])

  // The gameplay is not there.
  const none = await swamp({ gameplay: "none" })
  expect(abilityActionGaps(none.project)).toMatchObject([{ gap: "no_gameplay", slug: "swamp_summon", action: "summon_frogs", ability: { id: "summon_frogs" }, hit: 0 }])
  const gone = reconcile(none.project, names(none.project)).filter((finding) => finding.rule === "ability_gameplay")
  expect(gone).toMatchObject([{ stops: true, about: { kind: "entity", id: none.golem.id } }])
  expect(gone[0]!.text).toBe("「晶石傀儡」的招式「召唤小毒蛙」第 1 次出手要交给一个玩法的代码去做，可是工程里找不到那个玩法（可能被删掉了）。")
  expect(gone[0]!.detail).toContain("gameplay swamp_summon, action summon_frogs")
  // Said to the person without the names of the code.
  expect(`${gone[0]!.text}${gone[0]!.fix}`).not.toMatch(/swamp_summon|summon_frogs|abilityAction|ProjectContent/)

  // The gameplay is there and registers another name.
  const other = await swamp({ gameplay: "other_entry" })
  const silent = reconcile(other.project, names(other.project)).filter((finding) => finding.rule === "ability_gameplay")
  expect(silent).toMatchObject([{ stops: true }])
  expect(silent[0]!.text).toContain(`要交给玩法「${other.document.name}」去做，可是那个玩法的代码里没有接这一招的入口`)
  expect(`${silent[0]!.text}${silent[0]!.fix}`).not.toMatch(/summon_frogs|abilityAction|ProjectContent/)
  expect(silent[0]!.detail).toContain("does not register this action")
  // A creature that does not fight never has its abilities built, so nothing is asked of a gameplay for it.
  expect(abilityActionGaps({ ...other.project, entities: other.project.entities.map((entity) => ({ ...entity, behavior: "passive" as const })) })).toEqual([])
})

test("the code check holds the gameplay to the entries its creatures ask for, and to how an entry is named", async () => {
  const made = await swamp({ gameplay: "other_entry" })
  const asset = made.project.workspace.assets.find((value) => value.document.kind === "gameplay" && value.document.slug === "swamp_summon")!
  const document = asset.document as unknown as GameplayDocument
  const found = (changed: GameplayDocument, id: string | null = asset.id) => checkGameplayReferences(made.project, changed, id)
  // The ability asks for summon_frogs and the code registers summon_toads: the check fails, naming the creature and the move.
  const missing = found(document).filter((finding) => finding.rule === "ability_action_missing")
  expect(missing).toHaveLength(1)
  expect(missing[0]!.message).toContain("「晶石傀儡」的招式「召唤小毒蛙」第 1 次出手要交给这个玩法的入口 summon_frogs，可是代码里没有登记它")
  expect(missing[0]!.fix).toContain('ProjectContent.abilityAction("summon_frogs"')
  expect(staticChecks(made.project, document, asset.id).references.map((finding) => finding.rule)).toContain("ability_action_missing")
  // Registered under the name the ability writes, the check is quiet (and the bounds scan is too).
  const right = { ...document, sources: [{ path: "Main.java", content: frogs(made.project.mod_id) }] }
  expect(found(right)).toEqual([])
  expect(staticChecks(made.project, right, asset.id)).toMatchObject({ bounds: [], references: [] })
  // A name that is not written out cannot be matched against the ability.
  const computed = { ...right, sources: [{ path: "Main.java", content: right.sources[0]!.content.replace('"summon_frogs"', 'String.valueOf(1) + "frogs"') }] }
  expect(found(computed).map((finding) => finding.rule)).toContain("accessor_argument")
  // A name spelled the way no ability can write it.
  const spelled = { ...right, sources: [{ path: "Main.java", content: right.sources[0]!.content.replace('"summon_frogs"', '"Summon-Frogs"') }] }
  expect(found(spelled).map((finding) => finding.rule)).toContain("ability_action_name")
  // Two entries of one name, in one gameplay or in two: the game would refuse the second at start.
  const twice = { ...right, sources: [{ path: "Main.java", content: right.sources[0]!.content.replace("        ProjectContent.abilityAction", '        ProjectContent.abilityAction("summon_frogs", (creature, target) -> { });\n        ProjectContent.abilityAction') }] }
  expect(found(twice).filter((finding) => finding.rule === "ability_action_taken")).toHaveLength(1)
  const answered = await swamp()
  const rival = { ...document, slug: "rival", sources: [{ path: "Main.java", content: frogs(answered.project.mod_id).replace("swamp_summon", "rival") }] }
  expect(checkGameplayReferences(answered.project, rival, null).map((finding) => finding.rule)).toContain("ability_action_taken")
  // The generated side of the call is not the gameplay's to make.
  const calling = { ...right, sources: [{ path: "Main.java", content: right.sources[0]!.content.replace("ProjectContent.abilityAction(", "ProjectContent.runAbility(") }] }
  expect(found(calling).map((finding) => finding.rule)).toContain("unknown_accessor")
  // The words for the person exist for every new rule, and say no name of code; the AI is told no rule id.
  for (const rule of ["ability_action_missing", "ability_action_name", "ability_action_taken"]) {
    expect(RULE_IDS).toContain(rule)
    expect((PLAIN_RULES as Record<string, string>)[rule]).toMatch(/。$/)
    expect(GAMEPLAY_API_WORDS.join("")).not.toContain(rule)
    expect(GAMEPLAY_DISCIPLINE).not.toContain(rule)
    expect(ABILITY_INSTRUCTIONS).not.toContain(rule)
  }
})

test("a build of what is saved stops on a missing gameplay or entry, in the words of the finding; one that is answered builds and carries the call", async () => {
  const none = await swamp({ gameplay: "none" })
  await mkdir(path.join(none.base, "source"))
  const stopped = await assembleBuildSource(none.directory, path.join(none.base, "source"), TEMPLATE).then(() => null, (error: unknown) => error)
  expect(stopped).toBeInstanceOf(BuildStop)
  expect((stopped as BuildStop).rule).toBe("ability_gameplay")
  expect((stopped as BuildStop).message).toContain("要交给一个玩法的代码去做，可是工程里找不到那个玩法")

  const answered = await swamp()
  const source = path.join(answered.base, "source")
  await mkdir(source)
  const built = await assembleBuildSource(answered.directory, source, TEMPLATE)
  expect(built.findings.filter((finding) => finding.rule === "ability_gameplay")).toEqual([])
  // A gameplay being checked is held to its own entries by its check (above); the build that checks it assembles the project with its candidate in the place of the saved one and is not stopped by it.
  const other = await swamp({ gameplay: "other_entry" })
  await mkdir(path.join(other.base, "source"))
  const rival = other.project.workspace.assets.find((value) => value.document.kind === "gameplay" && value.document.slug === "swamp_summon")!
  await assembleBuildSource(other.directory, path.join(other.base, "source"), TEMPLATE, { candidate: { asset_id: rival.id, title: rival.title, document: { ...(rival.document as unknown as GameplayDocument), sources: [{ path: "Main.java", content: frogs(other.project.mod_id) }] } } })
  expect(await Bun.file(path.join(other.base, "source", "src/main/java/com/minemods/content_azure_sample/gameplay/swamp_summon/Main.java")).text()).toContain('abilityAction("summon_frogs"')
  if (!hasTargetJavac(OFFICIAL)) return
  // The tree the build wrote compiles against the game: the generated creature, the accessor, the interface and the gameplay's own entry.
  const compiled = (await compileTreeFor(OFFICIAL, source))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 240000)

test("the reviewer is told what the generated class does at such a moment, and that what the gameplay does there was not read", async () => {
  const made = await swamp()
  const contract = (await gameplayContract(made.directory, [made.golem.id])).join("\n")
  expect(contract).toContain("第 1 秒（第 20 刻）不是判定，而是调用玩法登记的入口 summon_frogs（传进去的是放招的生物和它的目标；那一刻做什么是那个玩法的事，这里没有读，要进游戏看）")
  expect(contract).toContain("在玩家自己的游戏里不调用。入口里抛出的异常只记进日志，招式照常往下走")
  // The summon is not counted as a blow: the line does not promise anyone is hurt at that moment, and does not say the moment could not be read.
  expect(contract).not.toContain("没有读到它出手的时刻")
})

// ---- the words ----

test("whoever writes a creature or a gameplay is told how the two meet, and the card says which gameplay a moment is handed to", async () => {
  expect(ABILITY_INSTRUCTIONS).toContain('{type:"gameplay", at, gameplay:"玩法的 slug", action:"入口名"}')
  expect(ABILITY_INSTRUCTIONS).toContain("ProjectContent.abilityAction(")
  expect(ABILITY_SUMMARY).toContain("交给玩法的代码去做")
  const words = GAMEPLAY_API_WORDS.join("")
  expect(words).toContain(`${GAMEPLAY_API.content}.abilityAction("入口名", (creature, target) -> { … })`)
  expect(words).toContain("什么时候放是招式的事")
  // The card's sentence names the gameplay when it can; without the project it does not guess a name.
  expect(abilityWords.hit(summon.hits[0]!, () => "沼泽巫祝召唤小毒蛙")).toBe("第 1 秒由玩法「沼泽巫祝召唤小毒蛙」的代码接着做（做什么、做到什么程度，看那个玩法的说明，要进游戏看）")
  expect(abilityWords.hit(summon.hits[0]!)).toBe("第 1 秒由玩法的代码接着做（做什么、做到什么程度，看那个玩法的说明，要进游戏看）")
  expect(abilityWords.summary(summon, "；", () => "召唤")).toContain("由玩法「召唤」的代码接着做")
  // Nothing is claimed of what the move does to anybody: the person is asked to look, not told.
  expect(abilityWords.felt(summon)).toBeNull()
  // A creature whose only move is handed to a gameplay still gets a step in the guide's list of what to test, and it says whom to look to.
  const made = await swamp()
  const { modGuide } = await import("../src/guide")
  const guide = JSON.stringify(modGuide(made.project, { findings: [], animations: names(made.project).animations, glowing: [], built: true }))
  expect(guide).toContain("这一招有一刻由玩法")
  expect(guide).toContain(`「${made.document.name}」的代码接着做`)
})

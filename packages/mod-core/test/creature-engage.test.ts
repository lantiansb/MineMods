import { BossSchema } from "../src/entity-runtime"
import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { creatureContractLines, gameplayContract, accessorContractLines, readGeneratedCreature } from "../src/creature-contract"
import { CREATURE_LIFE_INSTRUCTIONS, creatureFacets, creatureWords } from "../src/creature-life"
import { ENGAGEMENT_MODES, EntitySchema, type Engagement } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { gameplaySupport, projectContentSource } from "../src/fabric/gameplay"
import type { GameplayDocument } from "../src/gameplay"
import { modGuide } from "../src/guide"
import { GAMEPLAY_API_WORDS } from "../src/gameplay-check"
import { checkGameplayReferences, gameplayHolds, governedCreatures } from "../src/gameplay-references"
import { GAMEPLAY_LIFE_WORDS } from "../src/gameplay-words"
import type { ModuleDocument } from "../src/workspace"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac, targetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-engage-"))
  roots.push(root)
  return root
}

const runtime = { spawn: null, explosion: null, movement: "direct" as const, armor: 0, charging_armor: 0, texture_asset_id: null }
const fused = { ...runtime, explosion: { radius: 3, fuse_ticks: 30, damage_blocks: false, effects: [] } }
const plain = { modId: "engage_mod", packageName: "com.minemods.content_engage_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const java = (input: Record<string, unknown>) => String((compileEntity({ ...plain, ...input }) as Record<string, string | Uint8Array>)["src/main/java/com/minemods/content_engage_mod/entity/StudioCreature.java"])
const lines = (source: string) => creatureContractLines({ title: "守卫", key: "guardian-id" }, readGeneratedCreature(source, null)).join("\n")

test("who a creature fights is one optional field: absent it is the creature it was, byte for byte", () => {
  const old = { id: "11111111-1111-4111-8111-111111111111", name: "苔皮苦力怕", description: "", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile", model_asset_id: null, runtime }
  expect(JSON.stringify(EntitySchema.parse(old))).toBe(JSON.stringify(old))
  ENGAGEMENT_MODES.forEach((engagement) => expect(EntitySchema.parse({ ...old, engagement }).engagement).toBe(engagement))
  expect(EntitySchema.safeParse({ ...old, engagement: "everything" }).success).toBe(false)
  // Neither the field nor a rule of gameplay code: the older shape, whatever else the creature has. Null and false are the same as absent.
  ;[{}, { runtime }, { abilities: golemAbilities }, { runtime, abilities: golemAbilities }, { gameplayGoals: true, runtime }].forEach((input) => {
    expect(java({ ...input, engagement: null, targetRules: false })).toBe(java(input))
    expect(java(input)).not.toMatch(/engageAllows|EngageTargetGoal|customServerAiStep|mayTarget/)
  })
  // Only a creature that fights has anybody to engage: on the others the field changes nothing.
  ;(["passive", "follow"] as const).forEach((behavior) => expect(java({ behavior, runtime, engagement: "provoked", targetRules: true })).toBe(java({ behavior, runtime })))
  expect(CREATURE_LIFE_INSTRUCTIONS).toContain(`engagement 只对敌对生物（behavior=hostile）有意义，说它怎么开打：${ENGAGEMENT_MODES.join("|")}。`)
})

test("with the field or a rule, everything the creature does to fight acts on its target alone, and one place decides who that is", () => {
  const shapes = [{}, { runtime }, { runtime: fused }, { abilities: golemAbilities }, { runtime, abilities: golemAbilities }]
  ENGAGEMENT_MODES.forEach((engagement) =>
    shapes.forEach((shape) => {
      const source = java({ ...shape, engagement, gameplayGoals: true })
      // It no longer looks for a player in its movement goal, and no vanilla target goal is left to hand a dropped target back.
      expect(source).not.toMatch(/runtimeNearestPlayer|NearestAttackableTargetGoal|HurtByTargetGoal/)
      expect(source.includes("targetSelector.addGoal(1, new EngageTargetGoal());")).toBe(engagement !== "none_by_itself")
      expect(source).toContain("if (!engageAllows(target) || engageUnseenTicks > ENGAGE_UNSEEN_TICKS) setTarget(null);")
      expect(source).toContain("&& ProjectContent.mayTarget(this, candidate);")
      const facts = readGeneratedCreature(source, null)
      expect(facts.engage).toEqual({ distance: 24, unseen: 60, attack_distance: null, attackable: true, ruled: true, lets_go: true, ability_ends: "abilities" in shape })
      expect(facts.inner.filter((goal) => goal.seeks)).toEqual([])
      expect(facts.inner.flatMap((goal) => (goal.picks ? [goal.picks] : []))).toEqual(engagement === "none_by_itself" ? [] : [engagement])
      // Whatever fights at priority 1 goes after getTarget(): the generated goals say so in their bodies, the vanilla one by what it is.
      expect(facts.goals.filter((goal) => !goal.target && goal.priority === 1).map((goal) => goal.type === "MeleeAttackGoal" || facts.inner.some((inner) => inner.type === goal.type && inner.chases))).toEqual([true])
    }),
  )
  // A project without gameplay code has no rules to ask; a rule of gameplay code alone (no field) gives the creature that goes for players.
  expect(java({ engagement: "provoked" })).not.toContain("mayTarget")
  expect(readGeneratedCreature(java({ runtime, targetRules: true, gameplayGoals: true }), null).inner.flatMap((goal) => (goal.picks ? [goal.picks] : []))).toEqual(["any_player"])
  const fuse = java({ runtime: fused, engagement: "provoked" })
  expect(fuse).toContain("LivingEntity target = getTarget();\n        boolean charging = target != null && distanceToSqr(target) <= RUNTIME_FUSE_DISTANCE * RUNTIME_FUSE_DISTANCE;")
})

test("the reviewer is told who it fights from the generated class, in both shapes, and a class that stops doing it stops being vouched for", () => {
  const said = (engagement: Engagement, shape: Record<string, unknown> = { runtime }) => lines(java({ ...shape, engagement, gameplayGoals: true }))
  expect(said("any_player")).toContain("选目标（targetSelector）：1 EngageTargetGoal（Studio 生成的：只在它还没有目标的时候，把 24 格内看得见的、最近的、可以打的玩家定为目标；占 TARGET）。")
  expect(said("provoked")).toContain("1 EngageTargetGoal（Studio 生成的：只在它还没有目标的时候，把刚打了它的那一个（同类不算）定为目标；占 TARGET）。")
  expect(said("none_by_itself")).toContain("它的 targetSelector 里没有它自己的行为：它自己从不选目标，只有玩法代码给它目标（addTargetGoal 加的行为，或者 mob.setTarget(...)）它才开打。")
  expect(said("any_player")).toContain("它打谁：它自己所有去打人的行为（RuntimeMovementGoal）都只对它的目标（getTarget()）行动，目标是谁定的都一样。没有目标时这些行为不运行，它的身体（MOVE、LOOK）是空出来的：玩法加在 2 到 4 的行为这时可以上场，没有的话它照常闲逛、张望。")
  expect(said("any_player", {})).toContain("它自己所有去打人的行为（MeleeAttackGoal）都只对它的目标")
  expect(said("any_player")).toContain("目标每一刻都重新核对（生成的 customServerAiStep，服务端），不管目标是谁定的：目标死了、不在同一个世界了、成了打不了的人（创造或旁观模式的玩家；和平难度下的玩家）、离它超过 24 格、连续 60 刻看不见，或者玩法代码用 ProjectContent.targetRule 给这种生物登记的规则对这个目标答了 false——它当刻放掉目标（setTarget(null)），去打人的行为随后一两刻内停下。它自己选目标之前也先问同一条规则：规则不答应的，不会被选上。")
  // The older shape is said as it is: its own chase does not read the target, so nothing gameplay decides reaches it.
  const older = lines(java({ runtime, gameplayGoals: true }))
  expect(older).toContain("它打谁：这一版里 RuntimeMovementGoal 不看它的目标——它自己找玩家、自己追，getTarget() 是谁都不影响它")
  expect(older).not.toContain("目标每一刻都重新核对")
  // Read, not remembered.
  const source = java({ runtime, abilities: golemAbilities, engagement: "any_player", gameplayGoals: true })
  expect(lines(source.replace("if (!engageAllows(target) || engageUnseenTicks > ENGAGE_UNSEEN_TICKS) setTarget(null);", ""))).toContain("这一版生成的代码里没有读到目标不再合格时放掉它的那一步，评审不能当它有。")
  expect(lines(source.replace("|| abilityTarget != getTarget()", ""))).toContain("这一版生成的代码里没有读到招式跟着目标中断的那一步，评审不能当它有。")
  expect(lines(source.replace("\n            && ProjectContent.mayTarget(this, candidate)", ""))).toContain("这一版生成的代码不问 ProjectContent.targetRule 的规则。")
  const accessor = projectContentSource({ modId: "engage_mod", items: [], blocks: [], creatures: [{ key: "11111111-1111-4111-8111-111111111111", registry: "creature" }] })
  expect(accessorContractLines(accessor)[1]).toStartWith('ProjectContent.targetRule("生物的 id", (mob, 候选) -> 可不可以打) 也只是登记：')
  expect(accessorContractLines(accessor.replace("if (!rule.test(mob, candidate)) return false;", ""))[1]).toBe("这一版生成的代码里没有读到ProjectContent.targetRule 的做法，评审不能当它有。")
})

test("gameplay code that rules on a creature's targets is what turns the creature; one that does not leaves the build as it was", async () => {
  const root = await temporary()
  const directory = path.join(root, "project")
  const project = await createDataGameplaySample(directory, { life: true })
  const asset = project.workspace.assets.find((value) => value.document.kind === "gameplay")!
  const guarding = asset.document as unknown as GameplayDocument
  const golem = `creature_${project.entities[0]!.id.replaceAll("-", "")}`
  expect([...governedCreatures(project)]).toEqual([golem])
  // The same gameplay without its rule, as a draft: it stands in for the saved one, and the creature is the older shape again.
  const ruleless = { ...guarding, sources: guarding.sources.map((file) => ({ ...file, content: file.content.replace("ProjectContent.targetRule(GUARDIAN, GuardPost::mayFight);", "") })) }
  expect([...governedCreatures(project, { asset_id: asset.id, document: ruleless })]).toEqual([])
  expect([...governedCreatures(project, { asset_id: asset.id, document: { sources: [{ path: "Main.java", content: guarding.sources[0]!.content.replace("targetRule(GUARDIAN, GuardPost::mayFight)", "addTargetGoal(GUARDIAN, 2, mob -> null)") }] } })]).toEqual([golem])
  const ruled = (await gameplayContract(directory, guarding.uses)).join("\n")
  expect(ruled).toContain("选目标（targetSelector）：1 EngageTargetGoal（Studio 生成的：只在它还没有目标的时候，把 24 格内看得见的、最近的、可以打的玩家定为目标；占 TARGET）。")
  expect(ruled).toContain("或者玩法代码用 ProjectContent.targetRule 给这种生物登记的规则对这个目标答了 false——它当刻放掉目标（setTarget(null)）")
  expect((await gameplayContract(directory, guarding.uses, { asset_id: asset.id, document: ruleless })).join("\n")).toContain("它打谁：这一版里 RuntimeMovementGoal 不看它的目标")
  // The reference check knows the hook, keeps the creature's own call to itself, and says when a target would change nothing.
  const check = (from: string, to: string, facts = project) => checkGameplayReferences(facts, { ...guarding, sources: guarding.sources.map((file) => ({ ...file, content: file.content.replace(from, to) })) }, asset.id)
  expect(check("", "")).toEqual([])
  expect(check("targetRule(GUARDIAN, GuardPost::mayFight)", "mayTarget(null, null)").map((finding) => finding.rule)).toEqual(["unknown_accessor"])
  expect(check("targetRule(GUARDIAN,", "targetRule(name(),").map((finding) => finding.rule)).toEqual(["accessor_argument"])
  const tame = check("", "", { ...project, entities: project.entities.map((entity) => ({ ...entity, behavior: "passive" as const })) })
  expect(tame.map((finding) => finding.rule)).toEqual(["target_unused"])
  expect(tame[0]!.message).toContain("但它不是敌对生物：它自己没有任何去打目标的行为，给它定了目标它也不会动手。")
  // broad20 P2-05: which gameplay is about the creature, read from the project: its saved code names it in a rule on its targets and adds behaviour to it; a draft without them leaves only `uses`.
  expect(gameplayHolds(project, golem)).toMatchObject([{ title: asset.title, target: true, goals: true }])
  expect(gameplayHolds(project, "creature_nobody")).toEqual([])
  expect(gameplayHolds(project, golem, { asset_id: asset.id, document: ruleless })).toMatchObject([{ target: false, goals: true }])
  expect(gameplayHolds(project, golem, { asset_id: asset.id, document: { sources: [], uses: [] } })).toEqual([])
  expect(creatureWords.held(gameplayHolds(project, golem)).target).toBe(`玩法「${asset.title}」的代码给它设了打谁的规则，实际打谁以那个玩法为准`)
  expect(creatureWords.held(gameplayHolds(project, golem, { asset_id: asset.id, document: ruleless })).target).toBeNull()
  // The mod guide says it beside the temper too.
  const guide = modGuide(project, { findings: [], animations: {}, glowing: [], built: false })
  expect(guide.markdown).toContain(`（玩法「${asset.title}」的代码给它设了打谁的规则，实际打谁以那个玩法为准）`)
  expect(modGuide({ ...project, workspace: { ...project.workspace, assets: project.workspace.assets.filter((value) => value.document.kind !== "gameplay") } }, { findings: [], animations: {}, glowing: [], built: false }).markdown).not.toContain("实际打谁以那个玩法为准")
  // The four questions say how it comes to fight, in a player's words, when the document says it; and which gameplay takes that over.
  const hostile = project.workspace.assets.find((value) => value.document.kind === "entity")!.document as Extract<ModuleDocument, { kind: "entity" }>
  expect(creatureFacets({ ...hostile, behavior: "hostile" }, project).find((facet) => facet.question === "reaction")?.words).toContain(`；玩法「${asset.title}」的代码给它设了打谁的规则，实际打谁以那个玩法为准`)
  const entity = project.workspace.assets.find((value) => value.document.kind === "entity")!.document as Extract<ModuleDocument, { kind: "entity" }>
  expect(creatureFacets({ ...entity, engagement: "provoked" }, project).find((facet) => facet.question === "reaction")?.words).toContain("；不主动打人，谁打了它它才打谁")
  // broad10 w4b: a boss asleep until somebody comes near is not said to wander about before it wakes.
  const boss = BossSchema.parse({ bar: { color: "purple", style: "notched_10", darken_sky: false }, intro: { wake_distance: 12, clip: "roar", seconds: 0.8, sound: null }, phases: [], death: { seconds: 4, xp_bursts: 6, explosion: false }, leash: { distance: 48, reset_seconds: 30 } })
  const sleeper = { ...entity, behavior: "hostile" as const, abilities: [], boss }
  expect(creatureFacets(sleeper, project).find((facet) => facet.question === "idle")?.words).toStartWith("一开始睡着不动，有人走到 12 格以内才醒；醒着没事的时候自己四处走动")
  expect(creatureFacets(entity, project).find((facet) => facet.question === "idle")?.words).toStartWith("没事的时候自己四处走动")
  // The whole mod: the golem is generated in the one-place shape and everything compiles together.
  const source = path.join(root, "source")
  await mkdir(source)
  await assembleBuildSource(directory, source, TEMPLATE)
  const creature = await readFile(path.join(source, `src/main/java/com/minemods/content_${project.mod_id}/entity/StudioCreature.java`), "utf8")
  expect(creature).toContain("targetSelector.addGoal(1, new EngageTargetGoal());")
  expect(creature).not.toContain("runtimeNearestPlayer")
  if (!hasTargetJavac(OFFICIAL)) return
  const compiled = (await compileTreeFor(OFFICIAL, source))!
  expect(compiled.output).not.toContain("error")
  expect(compiled.code).toBe(0)
}, 120000)

test("the words given to whoever writes gameplay separate whom it fights from what it does otherwise", () => {
  const words = GAMEPLAY_API_WORDS.join("")
  expect(words).toContain('ProjectContent.targetRule("资产 id", (mob, 候选) -> 可不可以打) 登记一条规则')
  expect(words).toContain("条件写成它没有目标（mob.getTarget() == null）时才上场")
  expect(GAMEPLAY_LIFE_WORDS).toContain("第三，它打谁，不靠抢它的身体来改")
})

test("every shape of the one-place creature compiles against Minecraft 1.21.1 beside the accessor", async () => {
  if (!hasTargetJavac(OFFICIAL)) return
  const root = await temporary()
  const shapes = [{}, { runtime }, { runtime: { ...runtime, movement: "strafe" } }, { runtime: fused }, { abilities: golemAbilities }, { runtime, abilities: golemAbilities }]
  await Promise.all(
    ENGAGEMENT_MODES.flatMap((engagement) => shapes.flatMap((shape) => [true, false].map((gameplayGoals) => ({ engagement, shape, gameplayGoals })))).map(async (made, index) => {
      const modId = `engage_${index}`
      const packageName = `com.minemods.content_${modId}`
      const files = compileEntity({ ...plain, ...made.shape, modId, packageName, engagement: made.engagement, gameplayGoals: made.gameplayGoals }) as Record<string, string | Uint8Array>
      await mkdir(path.join(root, modId), { recursive: true })
      await writeFile(path.join(root, modId, "StudioCreature.java"), String(files[`src/main/java/${packageName.replaceAll(".", "/")}/entity/StudioCreature.java`]))
      if (made.gameplayGoals) {
        const support = gameplaySupport({ modId, items: [], blocks: [], creatures: [{ key: "11111111-1111-4111-8111-111111111111", registry: "creature" }], gameplays: [] })
        // The accessor and the interface of an ability's entry it is written against.
        await Promise.all(Object.entries(support.files).filter(([file]) => /\/(ProjectContent|AbilityAction)\.java$/.test(file)).map(([file, source]) => writeFile(path.join(root, modId, file.split("/").at(-1)!), source)))
      }
    }),
  )
  const compiled = await targetJavac(OFFICIAL, root)
  expect(compiled.output).not.toContain("error")
  expect(compiled.code).toBe(0)
}, 120000)

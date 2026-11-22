import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { putModelAsset } from "../src/assets"
import { assembleBuildSource } from "../src/build-source"
import { accessorContractLines, gameplayContract } from "../src/creature-contract"
import { EntitySchema } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { projectContentSource } from "../src/fabric/gameplay"
import { GAMEPLAY_API, gameplayThings, type GameplayDocument } from "../src/gameplay"
import { GAMEPLAY_API_WORDS, staticChecks } from "../src/gameplay-check"
import { gameplayThingsForWriter } from "../src/gameplay-things"
import { GAMEPLAY_INSTRUCTIONS, GAMEPLAY_SHEET_INSTRUCTIONS, GAMEPLAY_WRITER_INSTRUCTIONS } from "../src/gameplay-words"
import { createEntity, openProject, saveProject, type Project } from "../src/project"
import { reconcile } from "../src/reconcile"
import { WorkspaceAssetSchema } from "../src/workspace"
import { createDataGameplaySample, fightingGolemDesign } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const clip = (name: string, length: number, loop: boolean) => ({ name, length, loop, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: length / 2, rotation: [-10, 0, 0] }, { time: length, rotation: [0, 0, 0] }] }] })
// The sample golem's body with a motion of its own beside the ones every creature has: a hen that lays.
const henDesign = { ...fightingGolemDesign, animations: [...fightingGolemDesign.animations.filter((animation) => ["idle", "walk", "hurt", "death"].includes(animation.name)), clip("lay", 1.2, false)] }
const entityFile = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const hen = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "彩虹鸡", health: 4, speed: 0.2, attack_damage: 0, behavior: "passive" as const, model: henDesign }

/** A gameplay that lays an egg on a timer: it adds its goal under the id it is given and plays the motion the way `lay` says. */
const laying = (modId: string, creature: string, play: string, uses: string[]): GameplayDocument => {
  const root = `com.minemods.content_${modId}.gameplay`
  return {
    kind: "gameplay",
    slug: "lay_egg",
    name: "下彩虹蛋",
    summary: "彩虹鸡闲着的时候隔一会儿下一个蛋。",
    behaviours: [{ when: "彩虹鸡没有目标，每过十秒", does: "播放下蛋的动作", shows: "鸡蹲下来下蛋" }],
    not_doing: ["不改它的目标和别的行为"],
    uses,
    sources: [
      {
        path: "Main.java",
        content: `package ${root}.lay_egg;

import ${root}.api.GameplayEntry;
import ${root}.api.ProjectContent;

public final class Main implements GameplayEntry {
    private static final String HEN = "${creature}";

    @Override
    public void onInitialize() {
        ProjectContent.addGoal(HEN, 3, LayEggGoal::new);
    }
}
`,
      },
      {
        path: "LayEggGoal.java",
        content: `package ${root}.lay_egg;

import ${root}.api.ProjectContent;
import java.util.EnumSet;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.goal.Goal;

final class LayEggGoal extends Goal {
    private static final String LAY = "lay";
    private final PathfinderMob mob;
    private int next = 200;

    LayEggGoal(PathfinderMob mob) {
        this.mob = mob;
        setFlags(EnumSet.of(Flag.JUMP));
    }

    @Override public boolean canUse() { return mob.getTarget() == null && mob.tickCount >= next; }

    @Override public boolean canContinueToUse() { return false; }

    @Override public void start() {
        next = mob.tickCount + 200;
        ${play}
    }
}
`,
      },
    ],
    data: [],
    lang: { zh_cn: {}, en_us: {} },
  }
}

/** A mod with a hen whose model has a lay motion, saved as Studio saves a creature: its model and its rules are two assets of one creature. */
async function project(play = 'ProjectContent.playMotion(mob, "lay");') {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-motion-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true })
  const chicken = EntitySchema.parse({
    ...createEntity({ name: "彩虹鸡", description: "会下彩虹蛋的小鸡。", health: 4, speed: 0.2, attack_damage: 0, behavior: "passive" }),
    runtime: { spawn: { biomes: ["minecraft:plains"], weight: 6, min: 1, max: 2 }, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null },
    name_en: "Rainbow hen",
  })
  const saved = await saveProject(directory, { ...sample, entities: [...sample.entities, chicken] }, sample.revision)
  const modelled = await putModelAsset(directory, { entity_id: chicken.id, data: { design: henDesign }, origin: "example", expectedRevision: saved.revision })
  const now = new Date().toISOString()
  const workspaceAsset = (id: string, module: string, title: string, dependencies: string[], document: unknown) => WorkspaceAssetSchema.parse({ id, module, title, revision: 1, created_at: now, updated_at: now, prompt: "彩虹鸡", dependencies, document, provenance: { model: "example", request_id: null }, status: "ready" })
  const { id: _id, model_asset_id: _model, ...rules } = chicken
  const rulesId = "c0000000-0000-4000-8000-000000000002"
  const gameplayId = "c0000000-0000-4000-8000-000000000001"
  const document = laying(modelled.project.mod_id, chicken.id, play, [chicken.id])
  const assets = [
    ...modelled.project.workspace.assets,
    workspaceAsset(chicken.id, "model", chicken.name, [], { kind: "model", ...henDesign }),
    workspaceAsset(rulesId, "entity", chicken.name, [chicken.id], { kind: "entity", ...rules, model_asset_id: chicken.id }),
    workspaceAsset(gameplayId, "gameplay", document.name, [chicken.id], document),
  ]
  const second = await saveProject(directory, { ...modelled.project, workspace: { assets } }, modelled.project.revision)
  return { root, directory, project: second, chicken, rulesId, document, gameplayId }
}

const animations = (made: Awaited<ReturnType<typeof project>>) => ({ [made.chicken.id]: henDesign.animations.map((animation) => animation.name) })
const unplayed = (made: { project: Project; chicken: { id: string } }, facts: Record<string, string[]>) => reconcile(made.project, { animations: facts }).filter((finding) => finding.rule === "animation_unplayed" && finding.about?.id === made.chicken.id)
/** The project with the hen's gameplay swapped for another code. */
const playing = (made: Awaited<ReturnType<typeof project>>, play: string): Project => ({
  ...made.project,
  workspace: { assets: made.project.workspace.assets.map((asset) => (asset.id === made.gameplayId ? { ...asset, document: laying(made.project.mod_id, made.chicken.id, play, [made.chicken.id]) } : asset)) },
})

test("what an AI writing gameplay is told names the call that plays a motion, and the call passes the checks", async () => {
  const call = `${GAMEPLAY_API.content}.playMotion(creature, "动作名")`
  expect(GAMEPLAY_API_WORDS.join("")).toContain(call)
  expect(GAMEPLAY_INSTRUCTIONS).toContain(call)
  expect(GAMEPLAY_WRITER_INSTRUCTIONS).toContain(call)
  // The one who writes the description first is shown the motions as well, so the description can say which one a creature makes.
  expect(GAMEPLAY_SHEET_INSTRUCTIONS).toContain("生物还带着它模型里的动作 motions")
  // The words say where the motions are listed and what is not a way to play one.
  expect(GAMEPLAY_API_WORDS.join("")).toContain("things 里每只生物的 motions")
  expect(GAMEPLAY_API_WORDS.join("")).toContain("只改生物的姿势或别的状态不会播放模型里的动作")
  const made = await project()
  const found = staticChecks(made.project, made.document, made.gameplayId)
  expect(found.bounds).toEqual([])
  expect(found.references).toEqual([])
  // A method the accessor does not have is refused, and the answer lists this one.
  const typo: GameplayDocument = { ...made.document, sources: made.document.sources.map((file) => ({ ...file, content: file.content.replace("playMotion(", "playMotions(") })) }
  const refused = staticChecks(made.project, typo, made.gameplayId).references
  expect(refused.map((finding) => finding.rule)).toEqual(["unknown_accessor"])
  expect(refused[0]!.fix).toContain("playMotion")
})

test("a motion the gameplay code plays through the call is not said to be never played, one it does not play is, and the redo goes to the gameplay", async () => {
  const made = await project()
  const bare = playing(made, "mob.setSneaking(true);")
  // Nothing plays lay: said, and handed over to the gameplay that points at the hen (it is the one whose code can play it).
  const before = unplayed({ project: bare, chicken: made.chicken }, animations(made))
  expect(before).toHaveLength(1)
  expect(before[0]!.detail).toBe("never played: lay; played: idle, walk, hurt, death")
  expect(before[0]!.redo).toEqual([{ kind: "gameplay", id: made.gameplayId, name: "下彩虹蛋" }])
  // The call, with the name written out or kept in a constant of the file.
  for (const play of ['ProjectContent.playMotion(mob, "lay");', "ProjectContent.playMotion(mob, LAY);"]) expect(unplayed({ project: playing(made, play), chicken: made.chicken }, animations(made))).toEqual([])
  // A name the model does not have plays nothing, so lay is still never played.
  expect(unplayed({ project: playing(made, 'ProjectContent.playMotion(mob, "laying");'), chicken: made.chicken }, animations(made))).toHaveLength(1)
  // With no gameplay pointing at the hen, the redo stays with the hen.
  const alone: Project = { ...made.project, workspace: { assets: made.project.workspace.assets.filter((asset) => asset.id !== made.gameplayId) } }
  expect(unplayed({ project: alone, chicken: made.chicken }, animations(made))[0]!.redo).toBeUndefined()
})

test("a creature is listed once however many assets read it, with its motions and whether anything plays them", async () => {
  const made = await project()
  const bare = playing(made, "mob.setSneaking(true);")
  // The project itself has two entries for the one creature (its model and its rules); the second is only another name for the first.
  const hens = gameplayThings(bare).filter((thing) => thing.kind === "creature" && thing.title === "彩虹鸡")
  expect(hens.map((thing) => [thing.asset_id, thing.alias_of])).toEqual([[made.chicken.id, null], [made.rulesId, made.chicken.id]])
  expect(new Set(hens.map((thing) => thing.registry)).size).toBe(1)
  // What the writer is shown: one line, the other id said to be the same creature, and the motion nothing plays.
  const shown = gameplayThingsForWriter(bare, made.gameplayId).filter((thing) => thing.title === "彩虹鸡")
  expect(shown).toHaveLength(1)
  expect(shown[0]).toMatchObject({ asset_id: made.chicken.id, kind: "生物", also_read_as: [made.rulesId] })
  expect(shown[0]!.motions).toEqual([{ clip: "idle", played: true }, { clip: "walk", played: true }, { clip: "hurt", played: true }, { clip: "death", played: true }, { clip: "lay", played: false }])
  // Once the gameplay plays it, it is still listed for that gameplay as one to play (what it did in an earlier version does not count), and it counts for any other gameplay.
  const done = made.project
  const own = gameplayThingsForWriter(done, made.gameplayId).find((thing) => thing.title === "彩虹鸡")!
  expect(own.motions!.find((motion) => motion.clip === "lay")).toEqual({ clip: "lay", played: false })
  expect(gameplayThingsForWriter(done, null).find((thing) => thing.title === "彩虹鸡")!.motions!.find((motion) => motion.clip === "lay")).toEqual({ clip: "lay", played: true })
  // The listing says nothing of itself, and the gameplay is not offered to itself.
  expect(shown.some((thing) => thing.asset_id === made.gameplayId)).toBe(false)
})

test("the accessor lists each creature once, keeps the other ids apart as names for it, and finds the creature by any of them", () => {
  const source = projectContentSource({
    modId: "m",
    items: [],
    blocks: [],
    creatures: [
      { key: "11111111-1111-4111-8111-111111111111", registry: "creature_a" },
      { key: "22222222-2222-4222-8222-222222222222", registry: "creature_a" },
      { key: "33333333-3333-4333-8333-333333333333", registry: "creature_b" },
    ],
  })
  const table = (name: string) => [...(new RegExp(`${name} = Map\\.ofEntries\\(([^;]*)\\);`).exec(source)?.[1] ?? "").matchAll(/Map\.entry\("([^"]+)", "([^"]+)"\)/g)].map((found) => [found[1], found[2]])
  // A walk over the creatures meets each of them once: no creature of the game stands twice in it.
  const creatures = table("ENTITIES")
  expect(creatures).toEqual([["11111111-1111-4111-8111-111111111111", "creature_a"], ["33333333-3333-4333-8333-333333333333", "creature_b"]])
  expect(new Set(creatures.map((entry) => entry[1])).size).toBe(creatures.length)
  // The other id is not a creature: it points at the first, and every lookup goes through the one place that follows it.
  expect(table("ALIASES")).toEqual([["22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111"]])
  expect(source).toContain("String registry = ENTITIES.get(ALIASES.getOrDefault(id, id));")
  expect(source.match(/ENTITIES\./g)).toHaveLength(1)
  expect(source).toContain("return BuiltInRegistries.ENTITY_TYPE.get(id(registry(id)));")
  expect(source).toContain("TARGET_RULES.computeIfAbsent(registry(id), name -> new ArrayList<>()).add(rule);")
  expect(source).toContain("GOALS.computeIfAbsent(registry(id), name -> new ArrayList<>()).add(goal);")
  // The reviewer's reading of the accessor still finds what it reads (the goals it adds, the rules, the check of the id).
  const lines = accessorContractLines(source).join("")
  expect(lines).toContain("id 不是这个工程的生物时")
  expect(lines).toContain("规则由这种生物自己来问")
  // A project with one id per creature has no names to follow.
  expect(projectContentSource({ modId: "m", items: [], blocks: [], creatures: [{ key: "k", registry: "creature_a" }] })).toContain("ALIASES = Map.of();")
})

test("a creature answers to the call only when the project has gameplay, with a controller of its own for each motion of its model", () => {
  const withGameplay = String(compileEntity({ ...hen, gameplayGoals: true })[entityFile])
  expect(withGameplay).toContain("implements GeoEntity, ProjectContent.StudioActor {")
  expect(withGameplay).toContain('PLAYABLE_MOTIONS = java.util.Set.of("idle", "walk", "hurt", "death", "lay");')
  expect(withGameplay).toContain('.triggerableAnim("lay", RawAnimation.begin().then("animation.creature.lay", Animation.LoopType.PLAY_ONCE))')
  expect(withGameplay).toContain('if (!isDeadOrDying()) triggerAnim("motion", motion);')
  // Without gameplay no one can ask, and the creature is exactly the class it was.
  const without = String(compileEntity(hen)[entityFile])
  for (const word of ["StudioActor", "PLAYABLE_MOTIONS", '"motion"']) expect(without).not.toContain(word)
})

test.skipIf(!hasTargetJavac(OFFICIAL))("gameplay that plays a motion and adds its goal under the second id compiles with the whole tree, and a reviewer is told the ids are one creature", async () => {
  const made = await project()
  // The goal is added under the id of the creature's rules, not its model: the lookup follows it to the same creature.
  const source = path.join(made.root, "source")
  await mkdir(source)
  const byRules: GameplayDocument = { ...made.document, sources: made.document.sources.map((file) => ({ ...file, content: file.content.replace(`"${made.chicken.id}"`, `"${made.rulesId}"`) })) }
  expect(staticChecks(made.project, byRules, made.gameplayId).references).toEqual([])
  await assembleBuildSource(made.directory, source, TEMPLATE)
  const built = (await compileTreeFor(OFFICIAL, source))!
  expect(built.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(built.code).toBe(0)
  // What the reviewer is given: one creature with its other id said to be the same, and the call that plays the motions nothing else plays.
  const lines = (await gameplayContract(made.directory, [made.rulesId], { asset_id: made.gameplayId, document: byRules })).join("\n")
  expect(lines).toContain(`代码里写作 "${made.chicken.id}"；"${made.rulesId}" 是读同一只生物的另一个 id，不是另一只生物`)
  expect(lines.match(/生物「彩虹鸡」/g)).toHaveLength(1)
  expect(lines).toContain('玩法代码调用 ProjectContent.playMotion(生物, "动作名")')
  expect(lines).toContain("能这样播的动作：idle、walk、hurt、death、lay")
  expect((await openProject(made.directory)).workspace.assets.some((asset) => asset.id === made.gameplayId)).toBe(true)
}, 240000)

import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { putModelAsset } from "../src/assets"
import { assembleBuildSource } from "../src/build-source"
import { accessorContractLines } from "../src/creature-contract"
import { CREATURE_LIFE_CAPABILITY } from "../src/creature-capability"
import { FLIGHT_INSTRUCTIONS } from "../src/creature-flight"
import { EntitySchema, FlightSchema } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { projectContentSource } from "../src/fabric/gameplay"
import { GAMEPLAY_API, gameplayThings, type GameplayDocument } from "../src/gameplay"
import { GAMEPLAY_API_WORDS, staticChecks } from "../src/gameplay-check"
import { GAMEPLAY_INSTRUCTIONS } from "../src/gameplay-words"
import { compileGameplayCandidate } from "../src/gameplay-compile"
import { FLIGHT_LIMITS } from "../src/flight-words"
import { createEntity, openProject, saveProject } from "../src/project"
import { WorkspaceAssetSchema } from "../src/workspace"
import { createDataGameplaySample, fightingGolemDesign } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"
import { officialJavacCompiler } from "./gameplay-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-steer-"))
  roots.push(root)
  return root
}

const clip = (name: string, length: number, loop: boolean) => ({ name, length, loop, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: length / 2, rotation: [-10, 0, 0] }, { time: length, rotation: [0, 0, 0] }] }] })
// The sample golem's body with the motions of the air beside its own (the budget is 16 motions); a passive flier has no use for the fighting ones.
const flierDesign = {
  ...fightingGolemDesign,
  animations: [...fightingGolemDesign.animations.filter((animation) => ["idle", "walk", "hurt", "death"].includes(animation.name)), clip("takeoff", 1, false), clip("fly", 1, true), clip("hover", 1, true), clip("land", 1, false)],
}
const hovering = FlightSchema.parse({ style: "hover", speed: 6, altitude: { min: 2, max: 6 }, turn: 200, climb: 40, bank: 20, air_share: 0.4, takeoff: { clip: "takeoff", seconds: 1 }, land: { clip: "land", seconds: 1 }, clips: { fly: "fly", glide: null, hover: "hover" } })
const flyer = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "小飞虫", health: 6, speed: 0.2, attack_damage: 0, behavior: "passive" as const, model: flierDesign }
const entityFile = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"

// A gameplay that only steers: every few ticks it asks the flier to a point beside it, and sometimes to come down.
const steering = (id: string, creature: string): GameplayDocument => {
  const root = `com.minemods.content_${id}.gameplay`
  return {
    kind: "gameplay",
    slug: "tend",
    name: "飞来飞去",
    summary: "没有目标的小飞虫每隔两秒飞到身边另一个点，偶尔落下来歇一会儿。",
    behaviours: [{ when: "小飞虫没有目标时，每两秒", does: "请它飞到身边 6 格内的一个点，二十分之一的机会请它就地落下", shows: "它在附近飞来飞去，偶尔落地" }],
    not_doing: ["不改它的目标和别的行为"],
    uses: [creature],
    sources: [
      {
        path: "Main.java",
        content: `package ${root}.tend;

import ${root}.api.GameplayEntry;
import ${root}.api.ProjectContent;

public final class Main implements GameplayEntry {
    private static final String FLYER = "${creature}";

    @Override
    public void onInitialize() {
        ProjectContent.addGoal(FLYER, 3, TendGoal::new);
    }
}
`,
      },
      {
        path: "TendGoal.java",
        content: `package ${root}.tend;

import ${root}.api.ProjectContent;
import java.util.EnumSet;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.goal.Goal;

final class TendGoal extends Goal {
    private final PathfinderMob mob;
    private int next;

    TendGoal(PathfinderMob mob) {
        this.mob = mob;
        setFlags(EnumSet.of(Flag.MOVE));
    }

    @Override public boolean canUse() { return mob.getTarget() == null && mob.tickCount >= next; }

    @Override public boolean canContinueToUse() { return false; }

    @Override public void start() {
        next = mob.tickCount + 40;
        BlockPos here = mob.blockPosition();
        double x = here.getX() + 0.5 + (mob.getRandom().nextDouble() - 0.5) * 12.0;
        double z = here.getZ() + 0.5 + (mob.getRandom().nextDouble() - 0.5) * 12.0;
        if (ProjectContent.isFlying(mob) && mob.getRandom().nextInt(20) == 0) ProjectContent.land(mob);
        else ProjectContent.flyTo(mob, x, here.getY() + 2.0, z);
    }
}
`,
      },
    ],
    data: [],
    lang: { zh_cn: {}, en_us: {} },
  }
}

/** A mod with one hovering flier and the sample's own gameplay, then a gameplay of ours that steers the flier through the accessor. */
async function project() {
  const root = await temporary()
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true })
  const bee = EntitySchema.parse({
    ...createEntity({ name: "萤蜂", description: "停在空中的小飞虫。", health: 6, speed: 0.2, attack_damage: 0, behavior: "passive" }),
    runtime: { spawn: { biomes: ["minecraft:plains"], weight: 6, min: 1, max: 2 }, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null },
    name_en: "Glowbee",
    flight: hovering,
  })
  const saved = await saveProject(directory, { ...sample, entities: [...sample.entities, bee] }, sample.revision)
  const modelled = await putModelAsset(directory, { entity_id: bee.id, data: { design: flierDesign }, origin: "example", expectedRevision: saved.revision })
  const now = new Date().toISOString()
  // As Studio saves a creature: its model and its rules are workspace assets, so gameplay code can name it.
  const workspaceAsset = (id: string, module: string, title: string, dependencies: string[], document: unknown) => WorkspaceAssetSchema.parse({ id, module, title, revision: 1, created_at: now, updated_at: now, prompt: "小飞虫", dependencies, document, provenance: { model: "example", request_id: null }, status: "ready" })
  const { id: _id, model_asset_id: _model, ...rules } = bee
  const document = steering(modelled.project.mod_id, bee.id)
  const asset = workspaceAsset("c0000000-0000-4000-8000-000000000001", "gameplay", document.name, [bee.id], document)
  const assets = [...modelled.project.workspace.assets, workspaceAsset(bee.id, "model", bee.name, [], { kind: "model", ...flierDesign }), workspaceAsset("c0000000-0000-4000-8000-000000000002", "entity", bee.name, [bee.id], { kind: "entity", ...rules, model_asset_id: bee.id }), asset]
  const second = await saveProject(directory, { ...modelled.project, workspace: { assets } }, modelled.project.revision)
  return { root, directory, project: second, bee, document, asset }
}

test("the accessor offers flyTo, isFlying and land, and the fliers it steers implement its interface", () => {
  const source = projectContentSource({ modId: "golem_mod", items: [], blocks: [], creatures: [{ key: "11111111-1111-4111-8111-111111111111", registry: "creature" }] })
  expect(source).toContain("public interface StudioFlier {")
  expect(source).toContain("public static void flyTo(Mob creature, double x, double y, double z) {")
  expect(source).toContain("public static boolean isFlying(Mob creature) {")
  expect(source).toContain("public static void land(Mob creature) {")
  // Anything that is not one of ours is sent along the ground, once; nothing is reflected into.
  expect(source).toContain("creature.getNavigation().moveTo(x, y, z, 1.0)")
  expect(source).not.toContain("reflect")
  const withGameplay = compileEntity({ ...flyer, flight: hovering, gameplayGoals: true }) as Record<string, string>
  const without = compileEntity({ ...flyer, flight: hovering }) as Record<string, string>
  expect(withGameplay[entityFile]).toContain("implements GeoEntity, ProjectContent.StudioFlier, ProjectContent.StudioActor {")
  expect(withGameplay[entityFile]).toContain("@Override public void studioFlyTo(double x, double y, double z)")
  // Without gameplay code no one can ask, and the flier is exactly the class it was.
  expect(without[entityFile]).not.toContain("StudioFlier")
  expect(without[entityFile]).not.toContain("flightRequest")
  // A creature that does not fly is untouched either way.
  expect(String(compileEntity({ ...flyer, gameplayGoals: true })[entityFile])).not.toContain("StudioFlier")
})

test("a request is one more thing that asks flightGo on every tick, ahead of the arrival check, and it is dropped when it is done", () => {
  const text = (compileEntity({ ...flyer, flight: hovering, gameplayGoals: true }) as Record<string, string>)[entityFile]!
  // A request is a temporary destination: it feeds the ask the flight already has, so goals, wandering and fighting are the creature's own.
  expect(text).toContain("flightGo(flightRequestPoint, flightRequestLand, !flightRequestLand);")
  expect(text).toContain("flightGravity();\n        flightRequestTick();\n        flightArrival();")
  expect(text).toContain(`FLIGHT_REQUEST_HOLD = ${FLIGHT_LIMITS.requestHold * 20};`)
  expect(text).toContain(`FLIGHT_REQUEST_GIVE_UP = ${FLIGHT_LIMITS.requestGiveUp * 20};`)
  // Asking the same place again does not start its stay there over; a new place does. Landing ends the moment it is down.
  expect(text).toContain("if (!same) flightRequestArrivedAt = -1;")
  expect(text).toContain("int hold = flightRequestLand ? 0 : FLIGHT_REQUEST_HOLD;")
  // The flier's feet go to y: the point it steers to is a body centre.
  expect(text).toContain("new Vec3(x, y + getBbHeight() / 2.0, z)")
  // A dead creature forgets it; the client does nothing.
  expect(text).toContain("flightRequestPoint = null;\n            flightReturning = false;")
  expect(text).toContain("if (level().isClientSide() || isDeadOrDying()) return;")
})

test("gameplay code that steers a flier passes every static check and says so in the contract", async () => {
  const made = await project()
  const found = staticChecks(made.project, made.document, made.asset.id)
  expect(found.bounds).toEqual([])
  expect(found.references).toEqual([])
  // The accessor is told to the writer, in the list every route reads, and the capability and the flight words name it.
  expect(GAMEPLAY_API_WORDS.join("")).toContain(`${GAMEPLAY_API.content}.flyTo(creature, x, y, z)`)
  expect(GAMEPLAY_INSTRUCTIONS).toContain("flyTo")
  expect(CREATURE_LIFE_CAPABILITY.done.join("")).toContain("ProjectContent.flyTo")
  expect(CREATURE_LIFE_CAPABILITY.not_done.join("")).toContain("ProjectContent.flyTo 不保证飞到")
  expect(FLIGHT_INSTRUCTIONS).toContain("ProjectContent.flyTo")
  const thing = gameplayThings(made.project).find((value) => value.key === made.bee.id)
  expect(thing?.kind).toBe("creature")
  const lines = accessorContractLines(projectContentSource({ modId: made.project.mod_id, items: [], blocks: [], creatures: [{ key: made.bee.id, registry: thing!.registry! }] }))
  expect(lines.join("")).toContain("flyTo(生物, x, y, z) 只是一个请求")
  // The same words with the accessor changed are not claimed: the line is read off the source.
  expect(accessorContractLines(projectContentSource({ modId: "m", items: [], blocks: [], creatures: [] }).replace("moveTo(x, y, z, 1.0)", "moveTo(x, y, z, 2.0)")).join("")).not.toContain("flyTo(生物, x, y, z) 只是一个请求")
})

test("what the accessor does not have, or the flier keeps private, is refused with a way out", async () => {
  const made = await project()
  const edit = (from: string, to: string): GameplayDocument => ({ ...made.document, sources: made.document.sources.map((file) => ({ ...file, content: file.content.replace(from, to) })) })
  const check = (document: GameplayDocument) => staticChecks(made.project, document, made.asset.id)
  // A method that is not there.
  expect(check(edit("ProjectContent.flyTo(", "ProjectContent.flyAbout(")).references.map((finding) => finding.rule)).toEqual(["unknown_accessor"])
  expect(check(edit("ProjectContent.flyTo(", "ProjectContent.flyAbout(")).references[0]!.fix).toContain("flyTo、isFlying、land")
  // Reaching for the generated class itself is the generated-class rule's, the flight's own `flightGo` never being public.
  const cast = edit("ProjectContent.flyTo(mob, x, here.getY() + 2.0, z)", "((com.minemods.content_golem_mod.entity.StudioCreature) mob).flightGo(null, false, false)")
  expect(check(cast).bounds.length).toBeGreaterThan(0)
})

test.skipIf(!hasTargetJavac(OFFICIAL))("gameplay code that calls flyTo, isFlying and land compiles with the support code, and the whole tree with a flier that answers it compiles", async () => {
  const made = await project()
  const run = await compileGameplayCandidate(made.directory, { templateDirectory: TEMPLATE, candidate: { asset_id: made.asset.id, title: made.document.name, document: made.document }, compiler: officialJavacCompiler })
  expect(run).toEqual({ ran: true, compile: { ok: true, findings: [], compiler: "javac (stand-in, Mojang's names)", note: null } })
  // A call with the wrong shape is the compiler's to catch.
  const wrong: GameplayDocument = { ...made.document, sources: made.document.sources.map((file) => ({ ...file, content: file.content.replace("here.getY() + 2.0, z)", "here.getY() + 2.0)") })) }
  expect(await compileGameplayCandidate(made.directory, { templateDirectory: TEMPLATE, candidate: { asset_id: made.asset.id, title: wrong.name, document: wrong }, compiler: officialJavacCompiler })).toMatchObject({ ran: true, compile: { ok: false } })
  // The whole generated tree: the flier implements the interface of the accessor and nothing is private to the gameplay.
  const source = path.join(made.root, "source")
  await mkdir(source)
  await assembleBuildSource(made.directory, source, TEMPLATE)
  const gameplay = `src/main/java/com/minemods/content_${made.project.mod_id}/gameplay`
  expect(await Bun.file(path.join(source, gameplay, "tend", "TendGoal.java")).text()).toContain("ProjectContent.flyTo(mob")
  expect(await Bun.file(path.join(source, gameplay, "api", "ProjectContent.java")).text()).toContain("creature instanceof StudioFlier flier")
  const entities = path.join(source, `src/main/java/com/minemods/content_${made.project.mod_id}/entity`)
  const classes = await Promise.all((await readdir(entities)).filter((file) => file.endsWith(".java")).map((file) => Bun.file(path.join(entities, file)).text()))
  expect(classes.filter((text) => text.includes("ProjectContent.StudioFlier"))).toHaveLength(1)
  const built = (await compileTreeFor(OFFICIAL, source))!
  expect(built.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(built.code).toBe(0)
  expect((await openProject(made.directory)).workspace.assets.some((asset) => asset.id === made.asset.id)).toBe(true)
}, 240000)

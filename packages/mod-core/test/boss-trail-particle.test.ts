import { afterEach, expect, test } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { posedCorners, type MotionClip } from "@minemods/studio-ai/model-motion"
import { TICKS, TRAIL_LIMITS } from "../src/ability-words"
import { abilityParticleIds, particleAsset, trailIssues, trailLine, trailPath, trailTip, TRAIL_INSTRUCTIONS } from "../src/ability-trails"
import { assembleBuildSource } from "../src/build-source"
import { PARTICLE_RUNTIME, compileParticles, particleTextureNames } from "../src/common/particles"
import { TRAIL_RUNTIME, compileTrails, trailSpec } from "../src/common/trails"
import { ABILITY_INSTRUCTIONS, abilityIssues, abilityWords, boneIssues } from "../src/creature-abilities"
import { AbilitySchema, EntitySchema, type Ability } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { genTarget } from "../src/platform/target"
import { readGeneratedCreature } from "../src/creature-contract"
import { PARTICLE_INSTRUCTIONS, PARTICLE_LIMITS, ParticleDocumentSchema, particleAt, particleLines, particleTicks, type ParticleDocument } from "../src/particle"
import { encodePng } from "../src/png"
import { saveProject } from "../src/project"
import { WorkspaceAssetSchema, WorkspaceSchema } from "../src/workspace"
import { MODULES, kindCapability, savedStatus } from "../src/workspace-modules"
import { createDataGameplaySample, fightingGolemDesign as fightingGolemSample, golemAbilities } from "../script/data-gameplay-sample"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * Boss 能力 11: weapon trails and the project's own particles. The definition, what the external AI is told, what is measured and said, the build's
 * files, and the loader-neutral Java (a particle with its provider, a trail renderer) that the platform layer registers and calls.
 */

const OFFICIAL = "fabric-1.21.1-official"
const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-trail-"))
  roots.push(root)
  return root
}
const sha = (files: Record<string, string | Uint8Array>) => {
  const text = Object.keys(files).sort().map((name) => `${name}\n${files[name]}`).join("\n")
  return `${createHash("sha256").update(text).digest("hex").slice(0, 16)} ${text.length}`
}

/** A square picture `side` pixels a side: a white dot in the middle on nothing. */
const dot = (side: number, height = side) => {
  const pixels = new Uint8Array(side * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < side; x++) {
      const inside = Math.hypot(x + 0.5 - side / 2, y + 0.5 - height / 2) < side / 3
      pixels.set(inside ? [255, 255, 255, 255] : [0, 0, 0, 0], (y * side + x) * 4)
    }
  return `data:image/png;base64,${Buffer.from(encodePng(pixels, side, height)).toString("base64")}`
}

const ember: ParticleDocument = ParticleDocumentSchema.parse({
  kind: "particle",
  name: "ember",
  frames: [dot(8), dot(8), dot(8)],
  frames_by: "age",
  lifetime: 1,
  gravity: -0.2,
  size: { start: 0.2, end: 0.05 },
  color: { start: "#ffcc66", end: "#ff3300" },
  opacity: { start: 1, end: 0 },
  emissive: true,
  spin: 90,
})
const EMBER_ID = "5a0c4b8e-0d3f-4a52-9d61-2f6a3b9c7e10"

const [slam, burst] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability, Ability]
const trail = { type: "trail" as const, at: 0.5, until: 0.75, bone: "arm_right", color: "#66ccff", width: 0.4, fade_ticks: 6 }
// The slam swings its right arm down from the end of its wind-up to the hit: a trail behind the arm's far end, and embers of the project's own where it lands.
const swing = AbilitySchema.parse({ ...slam, events: [...slam.events, trail, { type: "particle", at: 0.7, particle: { asset: EMBER_ID }, count: 8, forward: 1.2, up: 0.2, left: 0, spread: 0.4 }] })
// The sample is a plain object literal (its pivots are number[]); typed here as the model design it is.
const fightingGolemDesign = fightingGolemSample as unknown as ModelDesign
const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const entityPath = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"

test("old definitions generate the same Java to the byte, and the description includes how the particles are scattered", () => {
  // The same pins as hit-place-warn (taken at 16b48ee and renamed to Mojang's names only): nothing of trails or particles of its own is written for a creature without them.
  expect(sha(compileEntity({ ...plain, abilities: [slam, burst] }))).toBe("a013bae9c3c77759 60069")
  expect(abilityWords.events(slam)).toBe("第 0.7 秒「铁傀儡挥臂」的声音、尘土每把 12 颗，从脚下冒，前后偏移 1.2 格，上下偏移 0.1 格，第 0.7 秒开始，前后、上下、左右半径 0.6、0.6、0.6 格")
  // A creature with a trail differs only by what the trail adds.
  const old = String(compileEntity({ ...plain, abilities: [slam, burst] })[entityPath])
  const drawn = String(compileEntity({ ...plain, abilities: [AbilitySchema.parse({ ...slam, events: [...slam.events, trail] }), burst] })[entityPath])
  expect(drawn).not.toBe(old)
  expect(drawn.replace(/    \/\/ Boss 能力 11: its weapon trails[\s\S]*?    };\n/, "").replace(/    \/\*\* Boss 能力 11: which ability the server says[\s\S]*?\n\n/, "")).toBe(old)
})

test("a particle of its own is bounded and says what is wrong in plain words", () => {
  const refused = (change: Partial<Record<keyof ParticleDocument, unknown>>) => ParticleDocumentSchema.safeParse({ ...ember, ...change }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  expect(refused({})).toBe("")
  expect(refused({ frames: [] })).not.toBe("")
  expect(refused({ frames: Array.from({ length: 9 }, () => dot(8)) })).not.toBe("")
  expect(refused({ frames: [dot(8, 4)] })).toContain("要是正方形")
  expect(refused({ frames: [dot(64)] })).toContain(`边长不超过 ${PARTICLE_LIMITS.side} 像素`)
  expect(refused({ frames: ["data:image/png;base64,AAAA"] })).toContain("读不出来")
  expect(refused({ frames: [dot(8), dot(16)] })).toContain("几张图要一样大")
  expect(refused({ opacity: { start: 0, end: 0 } })).toContain("全透明")
  expect(refused({ name: "Ember" })).toContain("小写字母开头")
  expect(refused({ gravity: 3 })).not.toBe("")
  expect(refused({ size: { start: 3, end: 0.1 } })).not.toBe("")
  expect(refused({ color: { start: "red", end: "#ffffff" } })).toContain("#rrggbb")
  // Its kind: a look-and-feel thing, built into the mod on every target, saved ready.
  expect(MODULES.particle.label).toBe("粒子")
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
    expect(kindCapability("particle", target)).toBe("runtime")
    expect(savedStatus("particle", target)).toBe("ready")
  }
  expect(MODULES.entity.references.find((reference) => reference.field === "abilities")!.kinds).toEqual(["effect", "particle"])
})

test("one particle's life is one function: the picture by the game's own pick, size, tint and opacity straight from start to end", () => {
  expect(particleTicks(ember)).toBe(20)
  expect(particleAt(ember, 0)).toEqual({ frame: 0, size: 0.2, color: [1, 0.8, 0.4], opacity: 1, turn: 0 })
  const half = particleAt(ember, 10)
  // SpriteSet.get(age, lifetime): (pictures − 1) × age / lifetime, rounded down.
  expect(half.frame).toBe(1)
  expect(half.size).toBeCloseTo(0.125, 6)
  expect(half.opacity).toBeCloseTo(0.5, 6)
  expect(half.turn).toBeCloseTo(45, 6)
  expect(particleAt(ember, 20).frame).toBe(2)
  expect(particleAt({ ...ember, frames_by: "random" }, 20).frame).toBe(0)
  expect(particleLines(ember).join("\n")).toContain("图：3 张，每张 8×8，随着寿命一张接一张换。")
  expect(particleLines(ember).join("\n")).toContain("往上飘（重力 -0.2）")
  expect(particleLines(ember).join("\n")).toContain("自己发光")
})

test("a particle event names a vanilla particle as before, or one of the project's own by its asset id, which the creature must depend on", () => {
  const event = swing.events.at(-1)!
  expect(event.type === "particle" && particleAsset(event)).toBe(EMBER_ID)
  expect(abilityParticleIds([swing, slam])).toEqual([EMBER_ID])
  expect(AbilitySchema.safeParse({ ...slam, events: [{ ...slam.events[1]!, particle: { asset: "not-a-uuid" } }] }).success).toBe(false)
  expect(AbilitySchema.safeParse({ ...slam, events: [{ ...slam.events[1]!, particle: { asset: EMBER_ID, extra: 1 } }] }).success).toBe(false)
  expect(abilityWords.events(swing, id => id === EMBER_ID ? "余烬" : null)).toContain("余烬")
  expect(abilityWords.events(swing)).not.toContain(EMBER_ID)
  // The workspace holds the link: the creature depends on the particle, it is a particle, and two particles cannot share a name.
  const now = new Date().toISOString()
  const asset = (id: string, module: string, document: unknown, dependencies: string[] = []) => WorkspaceAssetSchema.parse({ id, module, title: module, revision: 1, created_at: now, updated_at: now, prompt: "x", dependencies, document, provenance: { model: null, request_id: null }, status: "ready" })
  const modelId = randomUUID()
  const golem = EntitySchema.parse({ id: modelId, name: "傀儡", description: "", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile", model_asset_id: modelId, runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null }, abilities: [swing] })
  const { id: _id, model_asset_id: _model, ...rules } = golem
  const creature = (dependencies: string[]) => asset(randomUUID(), "entity", { kind: "entity", ...rules, model_asset_id: modelId }, dependencies)
  const model = asset(modelId, "model", { kind: "model", ...fightingGolemDesign })
  const particle = asset(EMBER_ID, "particle", ember)
  expect(WorkspaceSchema.safeParse({ assets: [model, particle, creature([modelId, EMBER_ID])] }).success).toBe(true)
  expect(WorkspaceSchema.safeParse({ assets: [model, particle, creature([modelId])] }).error?.issues.map((issue) => issue.message)).toContain("Entity asset must depend on every particle workspace asset its abilities show")
  const twin = asset(randomUUID(), "particle", ember)
  expect(WorkspaceSchema.safeParse({ assets: [model, particle, twin, creature([modelId, EMBER_ID])] }).error?.issues.map((issue) => issue.message)).toContain("Another particle already uses the name ember; pick a different one")
})

test("a trail is drawn inside its ability and says what is wrong in plain words", () => {
  const refused = (change: Record<string, unknown>) => AbilitySchema.safeParse({ ...slam, events: [{ ...trail, ...change }] }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  expect(refused({})).toBe("")
  expect(refused({ until: 0.5 })).toContain("要比开始（at）晚")
  expect(refused({ until: 1.3 })).toContain("不能比招式全长（length）还晚")
  expect(refused({ color: "blue" })).toContain("#rrggbb")
  expect(refused({ width: TRAIL_LIMITS.width.max + 0.1 })).not.toBe("")
  expect(refused({ fade_ticks: 0 })).not.toBe("")
  expect(refused({ fade_ticks: 1.5 })).not.toBe("")
  expect(abilityWords.events(AbilitySchema.parse({ ...slam, events: [trail] }))).toBe("第 0.5–0.75 秒「arm_right」末端拖出 #66ccff 的光带（宽 0.4 格，每一段 6 刻淡掉）")
})

test("the far end of a part is the corner of its own cubes furthest from its pivot, and it is where the posed model puts that corner", () => {
  // arm_right pivots at (-7, 19, 0); its cubes are 4×8×4 from (-9, 12, -2) and 4×4×4 from (-9, 8, -2). The lowest corners of the hand are furthest: 11.36 pixels.
  const tip = trailTip(fightingGolemDesign, "arm_right")!
  expect(tip.cube).toBe(1)
  expect(tip.corner).toBe(0)
  expect(tip.local).toEqual([2 / 16, -11 / 16, -2 / 16])
  expect(tip.reach).toBeCloseTo(Math.hypot(2, 11, 2) / 16, 3)
  // A part with no cube of its own has no end; nor has one the model lacks.
  const bare = { bones: [...fightingGolemDesign.bones, { ...fightingGolemDesign.bones[2]!, name: "socket", cubes: [] }] }
  expect(trailTip(bare as never, "socket")).toBeNull()
  expect(trailTip(fightingGolemDesign, "sword")).toBeNull()
  // At rest the corner sits where the built model has it: pivot plus the far end, the X of the document turned round.
  const clip = fightingGolemDesign.animations.find((animation) => animation.name === "slam") as MotionClip
  const rest = posedCorners({ bones: fightingGolemDesign.bones.map((bone) => ({ ...bone, rotation: [0, 0, 0] as [number, number, number] })) }, null)[tip.index]!
  expect(rest).toEqual([7 + 2, 19 - 11, -2])
  // The path is that corner at every tick from the tick of `at` to the tick of `until`.
  const path = trailPath(swing, 2, fightingGolemDesign)!
  expect(path.from).toBe(10)
  expect(path.to).toBe(15)
  expect(path.points).toHaveLength(6)
  expect(path.points[3]).toEqual(posedCorners(fightingGolemDesign, clip, 13 / TICKS)[tip.index]!)
  expect(path.travel).toBeGreaterThan(TRAIL_LIMITS.still)
  expect(trailLine(swing, 2, fightingGolemDesign)).toContain("末端是「arm_right」自己第 2 个方块离转轴最远的那个角")
})

test("the reviewer is told when a trail is too short to see or follows a part that does not move then; a part that is not there, or has no cube, stops the build", () => {
  const issues = (events: Ability["events"]) => abilityIssues({ name: "傀儡", behavior: "hostile", abilities: [AbilitySchema.parse({ ...slam, events })] }, fightingGolemDesign.animations, fightingGolemDesign)
  expect(issues([trail]).filter((issue) => issue.rule === "ability_trail" || issue.rule === "ability_bone")).toEqual([])
  const short = issues([{ ...trail, at: 0.5, until: 0.55 }]).filter((issue) => issue.rule === "ability_trail")
  expect(short).toHaveLength(1)
  expect(short[0]!.text).toContain(`不到 ${TRAIL_LIMITS.shortest} 刻`)
  expect(short[0]!.stops).toBe(false)
  // The wave moves the left arm alone: the right one hangs still all through it.
  const waving = AbilitySchema.parse({ ...slam, id: "wave", clip: "wave", windup: 0.3, length: 1, hits: [{ ...slam.hits[0]!, at: 0.5 }], events: [{ ...trail, at: 0.3, until: 0.8 }] })
  const still = abilityIssues({ name: "傀儡", behavior: "hostile", abilities: [waving] }, fightingGolemDesign.animations, fightingGolemDesign).filter((issue) => issue.rule === "ability_trail")
  expect(still).toHaveLength(1)
  expect(still[0]!.text).toContain("这段时间这个部件没怎么挥")
  const missing = issues([{ ...trail, bone: "sword" }]).filter((issue) => issue.rule === "ability_bone")
  expect(missing).toHaveLength(1)
  expect(missing[0]!.stops).toBe(true)
  expect(missing[0]!.text).toContain("模型里没有这个部件")
  const bare = { ...fightingGolemDesign, bones: [...fightingGolemDesign.bones, { ...fightingGolemDesign.bones[2]!, name: "socket", parent: "arm_right", cubes: [] }] }
  const empty = boneIssues({ name: "傀儡", abilities: [AbilitySchema.parse({ ...slam, events: [{ ...trail, bone: "socket" }] })] }, bare)
  expect(empty).toHaveLength(1)
  expect(empty[0]!.text).toContain("这个部件自己一个方块也没有")
  // Without the model nothing is measured of where the end is; the length still is.
  expect(trailIssues({ name: "傀儡", abilities: [waving] }, null)).toEqual([])
})

test("the external AI is told how to write a trail and a particle of its own, and what each limit is", () => {
  expect(ABILITY_INSTRUCTIONS).toContain(TRAIL_INSTRUCTIONS)
  expect(TRAIL_INSTRUCTIONS).toContain('{type:"trail", at, until, bone, color, width, fade_ticks}')
  expect(TRAIL_INSTRUCTIONS).toContain("离它的转轴最远的那个角")
  expect(TRAIL_INSTRUCTIONS).toContain('{"asset":"粒子资产的 id"}')
  expect(TRAIL_INSTRUCTIONS).toContain(`${TRAIL_LIMITS.fade.min} 到 ${TRAIL_LIMITS.fade.max}`)
  expect(MODULES.particle.instructions).toContain(PARTICLE_INSTRUCTIONS)
  expect(PARTICLE_INSTRUCTIONS).toContain(`边长不超过 ${PARTICLE_LIMITS.side} 像素`)
  expect(PARTICLE_INSTRUCTIONS).toContain("frames_by")
})

test("the generated creature sends its own particles only once they are registered, and lists its trails for a player's game; the server does nothing at a trail", () => {
  const source = String(compileEntity({ ...plain, abilities: [swing, burst] })[entityPath])
  expect(source).toContain(`abilityOwnParticles("${EMBER_ID}", 1.2, 0.2, 0.0, 8, 0.4);`)
  expect(source).toContain(`SimpleParticleType type = ${PARTICLE_RUNTIME.table}.byAsset(asset);`)
  expect(source).toContain(`if (type == null || !${PARTICLE_RUNTIME.table}.registered(type)) return;`)
  expect(source).toContain("import net.minecraft.core.particles.SimpleParticleType;")
  expect(source).toContain(`public static final ${TRAIL_RUNTIME.spec}[] TRAILS = {\n        new ${TRAIL_RUNTIME.spec}(0, 10, 15, "arm_right", 0.125f, -0.6875f, -0.125f, 0x66ccff, 0.4f, 6),\n    };`)
  expect(source).toContain("public int studioAbilityShown() { return getEntityData().get(ABILITY); }")
  // No statement of the slam's step falls on the trail's first tick (10) but the ones that were already there.
  const step0 = /private void abilityStep0\(int tick\) \{\n([\s\S]*?)\n    \}\n/.exec(source)![1]!
  expect(step0).not.toContain("tick == 10)")
  expect(trailSpec(0, trail, [0.125, -0.6875, -0.125])).toBe(`new ${TRAIL_RUNTIME.spec}(0, 10, 15, "arm_right", 0.125f, -0.6875f, -0.125f, 0x66ccff, 0.4f, 6)`)
  // What the review reads back from the class is what it was: the trail and the particle add nothing it counts.
  expect(readGeneratedCreature(source, null).abilities).toEqual(readGeneratedCreature(String(compileEntity({ ...plain, abilities: [slam, burst] })[entityPath]), null).abilities)
})

test("a particle's files: its pictures and description where the game looks, and one table every side reads", () => {
  const made = compileParticles({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", particles: [{ id: EMBER_ID, document: ember }, { id: randomUUID(), document: { ...ember, name: "ash", frames: [dot(16)], frames_by: "random", emissive: false } }] })
  const resources = "src/main/resources/assets/golem_mod"
  expect(JSON.parse(String(made.files[`${resources}/particles/ember.json`]))).toEqual({ textures: ["golem_mod:ember_0", "golem_mod:ember_1", "golem_mod:ember_2"] })
  expect(particleTextureNames(ember)).toEqual(["ember_0", "ember_1", "ember_2"])
  expect(made.files[`${resources}/textures/particle/ember_1.png`]).toBeInstanceOf(Uint8Array)
  expect(made.files[`${resources}/textures/particle/ash_0.png`]).toBeInstanceOf(Uint8Array)
  const table = String(made.files[`src/main/java/com/minemods/content_golem_mod/entity/${PARTICLE_RUNTIME.table}.java`])
  // By name: ash before ember.
  expect(table).toContain('public static final String[] NAMES = {"ash", "ember"};')
  expect(table).toContain("public static final int[] LIFETIME = {20, 20};")
  expect(table).toContain("public static final boolean[] EMISSIVE = {false, true};")
  expect(table).toContain("public static final boolean[] BY_AGE = {false, true};")
  expect(table).toContain("public static final float[] SPIN = {0.07854f, 0.07854f};")
  expect(table).toContain("return new SimpleParticleType(false) {};")
  const particle = String(made.files[`src/main/java/com/minemods/content_golem_mod/client/${PARTICLE_RUNTIME.particle}.java`])
  expect(particle).toContain("public static final class Provider implements ParticleProvider<SimpleParticleType>")
  expect(particle).toContain("return ParticleRenderType.PARTICLE_SHEET_TRANSLUCENT;")
  // Nothing loader-specific: no Fabric, Forge or NeoForge name anywhere.
  expect(`${table}${particle}`).not.toMatch(/fabricmc|minecraftforge|neoforged/)
  expect(() => compileParticles({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", particles: [{ id: EMBER_ID, document: ember }, { id: randomUUID(), document: ember }] })).toThrow("PARTICLE_NAME_TAKEN")
})

test("the trail renderer differs between the two Minecrafts only in how a vertex is written, and names no loader", () => {
  const files = (minecraft: "1.21.1" | "1.20.1") => compileTrails({ packageName: "com.minemods.content_golem_mod", minecraft }).files
  const client = (minecraft: "1.21.1" | "1.20.1") => files(minecraft)[`src/main/java/com/minemods/content_golem_mod/client/${TRAIL_RUNTIME.client}.java`]!
  expect(client("1.21.1")).toContain("out.addVertex(pose, x, y, z).setColor(red, green, blue, alpha);")
  expect(client("1.20.1")).toContain("out.vertex(pose, x, y, z).color(red, green, blue, alpha).endVertex();")
  expect(client("1.21.1").replace("out.addVertex(pose, x, y, z).setColor(red, green, blue, alpha);", "")).toBe(client("1.20.1").replace("out.vertex(pose, x, y, z).color(red, green, blue, alpha).endVertex();", ""))
  expect(client("1.21.1")).toContain("bone.getLocalSpaceMatrix().transformPosition(new Vector3f(trail.tipX(), trail.tipY(), trail.tipZ()))")
  expect(client("1.21.1")).toContain("RenderType.lightning()")
  expect(client("1.21.1")).not.toMatch(/fabricmc|minecraftforge|neoforged/)
  expect(files("1.21.1")[`src/main/java/com/minemods/content_golem_mod/entity/${TRAIL_RUNTIME.spec}.java`]).toContain(`public record ${TRAIL_RUNTIME.spec}(int ability, int from, int until, String bone, float tipX, float tipY, float tipZ, int color, float width, int fade)`)
})

/** The sample project with the golem's slam drawing a trail and throwing embers of the project's own, the embers saved as a particle asset. */
async function trailProject() {
  const root = await temporary()
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const golem = sample.entities[0]!
  const abilities = EntitySchema.shape.abilities.unwrap().unwrap().parse([swing, burst])
  const now = new Date().toISOString()
  const particle = WorkspaceAssetSchema.parse({ id: EMBER_ID, module: "particle", title: "余烬", revision: 1, created_at: now, updated_at: now, prompt: "火星", dependencies: [], document: ember, provenance: { model: null, request_id: null }, status: "ready" })
  const assets = [particle, ...sample.workspace.assets.map((asset) => (asset.document.kind === "entity" && asset.document.model_asset_id === golem.id ? { ...asset, dependencies: [...asset.dependencies, EMBER_ID], document: { ...asset.document, abilities } } : asset))]
  const project = await saveProject(directory, { ...sample, entities: [{ ...golem, abilities }], workspace: { assets } }, sample.revision)
  const source = path.join(root, "source")
  await mkdir(source)
  return { root, project, source, built: await assembleBuildSource(directory, source, TEMPLATE) }
}

test("a project with a trail and a particle of its own builds their files; the whole tree compiles against Minecraft 1.21.1 (Mojang's names), GeckoLib 4.8.3 and Fabric API", async () => {
  const made = await trailProject()
  const base = path.join(made.source, "src/main/java/com/minemods/content_azure_sample")
  expect(await readFile(path.join(base, `entity/${PARTICLE_RUNTIME.table}.java`), "utf8")).toContain('{"ember"}')
  expect(await readFile(path.join(base, `client/${PARTICLE_RUNTIME.particle}.java`), "utf8")).toContain("extends TextureSheetParticle")
  expect(await readFile(path.join(base, `entity/${TRAIL_RUNTIME.spec}.java`), "utf8")).toContain("public record")
  expect(await readFile(path.join(base, `client/${TRAIL_RUNTIME.client}.java`), "utf8")).toContain("public void frame(")
  const resources = path.join(made.source, "src/main/resources/assets/azure_sample")
  expect(JSON.parse(await readFile(path.join(resources, "particles/ember.json"), "utf8"))).toEqual({ textures: ["azure_sample:ember_0", "azure_sample:ember_1", "azure_sample:ember_2"] })
  expect((await readFile(path.join(resources, "textures/particle/ember_2.png"))).subarray(1, 4).toString()).toBe("PNG")
  // A 组: wired on Fabric too. The particles are registered and given their providers by two entry points of their own; the creature's renderer draws its trails.
  const metadata = JSON.parse(await readFile(path.join(made.source, "src/main/resources/fabric.mod.json"), "utf8"))
  expect(metadata.entrypoints.main).toContain(`com.minemods.content_azure_sample.entity.${PARTICLE_RUNTIME.setup}`)
  expect(metadata.entrypoints.client).toContain(`com.minemods.content_azure_sample.client.${PARTICLE_RUNTIME.client}`)
  expect(await readFile(path.join(base, `entity/${PARTICLE_RUNTIME.setup}.java`), "utf8")).toContain("Registry.register(BuiltInRegistries.PARTICLE_TYPE, ResourceLocation.fromNamespaceAndPath(StudioParticles.MOD_ID, StudioParticles.NAMES[spec]), StudioParticles.TYPES[spec]);")
  expect(await readFile(path.join(base, `client/${PARTICLE_RUNTIME.client}.java`), "utf8")).toContain("ParticleFactoryRegistry.getInstance().register(StudioParticles.TYPES[spec], sprites -> new StudioParticle.Provider(sprites, spec));")
  const renderer = await readFile(path.join(base, "client/StudioCreatureRenderer.java"), "utf8")
  expect(renderer).toContain(`private final ${TRAIL_RUNTIME.client} trails = new ${TRAIL_RUNTIME.client}(StudioCreature.TRAILS);`)
  expect(renderer).toContain("trails.track(model);")
  expect(renderer).toContain("trails.frame(creature, creature.studioAbilityShown(), model, partialTick, poseStack, bufferSource);")
  const compiled = await compileTreeFor(OFFICIAL, made.source)
  if (!compiled) return
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 240000)

/**
 * The loader-neutral classes with their wiring (A 组), against each target's own class path: Forge 1.20.1 (GeckoLib 4.8.4, whose animation classes are in `software.bernie.geckolib.core`,
 * none of which these classes name) with the 1.20.1 vertex, and NeoForge 1.21.1 (GeckoLib 4.9.3) with the 1.21.1 one, each with the facade the wiring goes through; Fabric's wiring
 * is its own two entry points.
 */
for (const [target, id] of [["forge-1.20.1", "forge-1.20.1"], ["neoforge-1.21.1", "neoforge-1.21.1"], [OFFICIAL, "fabric-1.21.1"]] as const)
  test.skipIf(!hasTargetJavac(target))(`the particle and trail classes compile for ${target}`, async () => {
    const root = await temporary()
    const generation = genTarget(id)
    const pkg = "com.minemods.content_golem_mod"
    const particles = compileParticles({ modId: "golem_mod", packageName: pkg, particles: [{ id: EMBER_ID, document: ember }] }, generation)
    // The wiring: Fabric's entry points named in fabric.mod.json; a facade target's two classes run by the entries, through the facade.
    if (generation.loader.facade) {
      expect(Object.keys(particles.patch)).toEqual([])
      expect(particles.entries).toEqual({ common: [`${pkg}.entity.${PARTICLE_RUNTIME.setup}`], client: [`${pkg}.client.${PARTICLE_RUNTIME.client}`] })
      expect(Object.values(particles.files).some((text) => typeof text === "string" && /fabricmc|minecraftforge|neoforged/.test(text))).toBe(false)
    } else {
      expect(particles.entries).toEqual({ common: [], client: [] })
      const metadata = JSON.parse(particles.patch["src/main/resources/fabric.mod.json"]!(JSON.stringify({ entrypoints: { main: ["a.Main"], client: ["a.Client"] } })))
      expect(metadata.entrypoints).toEqual({ main: ["a.Main", `${pkg}.entity.${PARTICLE_RUNTIME.setup}`], client: ["a.Client", `${pkg}.client.${PARTICLE_RUNTIME.client}`] })
    }
    const files = {
      ...particles.files,
      ...compileTrails({ packageName: pkg, minecraft: generation.version.minecraft }).files,
      ...(generation.loader.facade
        ? { ...generation.loader.platformFiles({ modId: "golem_mod", packageName: pkg, version: generation.version }), "StudioClient.java": `package ${pkg}.client;\n\npublic final class StudioClient {\n    public static void register() {}\n}\n` }
        : {}),
    }
    await Promise.all(Object.entries(files).filter(([name]) => name.endsWith(".java")).map(([name, text]) => writeFile(path.join(root, path.basename(name)), String(text))))
    const compiled = await targetJavac(target, root)
    expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 120000)

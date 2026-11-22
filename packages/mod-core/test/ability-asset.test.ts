import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { BuildStop } from "../src/build-stop"
import { ABILITY_ASSET_INSTRUCTIONS, AbilityAssetDocumentSchema, abilityAssetIssues, abilityAssetLines, scaledAt, sharedAbilityInline, sharedAbilityIssues, withSharedAbilities, type AbilityAssetDocument } from "../src/ability-asset"
import { ABILITY_CAST, compileAbilityCast, patchGestureRuntime } from "../src/fabric/ability-cast"
import { genTarget } from "../src/platform/target"
import { openProject, saveProject } from "../src/project"
import { projectThings } from "../src/playable"
import { playFindings, reconcile } from "../src/reconcile"
import { MODULES, ModuleKindSchema } from "../src/workspace-modules"
import { WorkspaceSchema } from "../src/workspace"
import { ASSET_STANDARDS } from "../src/acceptance"
import type { TargetId } from "../src/target/ids"
import { CAST_SAMPLE_IDS, createTargetCastSample, fireball, frostBreath, renewal, tripleBolt } from "../script/target-cast-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * 技能资产: an ability any caster uses — a player through an item or a cast action's key, a block a player uses, a creature that names it. The definition and its refusals, what the
 * outside AI is told, the project's checks, a creature's use of one, the generated runtime and its byte-for-byte absence, and the Java on all three targets.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const refused = (document: unknown) => AbilityAssetDocumentSchema.safeParse(document).error?.issues.map((issue) => issue.message).join(" ") ?? ""

test("a cast stores its fixed warning before impact and plays its sound on that same target point",()=>{
  const sound={type:"sound",at:0.5,where:"hit",hit:0,sound:"entity.iron_golem.attack",volume:1,pitch:1,range_blocks:48}
  const hit={...frostBreath.hits[0],type:"area",at:1,place:"target",shape:{type:"sphere",forward:0,up:0,left:0,radius:2},warn:{seconds:0.6,look:"ring",color:"orange"}}
  const sample={...frostBreath,bindings:[],cast:{type:"instant",seconds:0,cooldown:2},hits:[hit],events:[sound],sounds:undefined}
  expect(refused({...sample,events:[{...sound,at:0.1}]})).toContain("第 0.4 秒")
  const document=AbilityAssetDocumentSchema.parse(sample)
  for(const target of Object.keys(CLASSPATH) as TargetId[]){
    const made=compileAbilityCast({modId:"test",packageName:"test",abilities:[{id:CAST_SAMPLE_IDS.frost,document}],gestures:[],sounds:{}},genTarget(target))
    const java=Object.values(made.files).join("\n")
    expect(java).toContain("c.emitHits.put(0,new Vec3[]{c.markers[0].spot()")
    expect(java).toContain("playSound(null, landing.x, landing.y, landing.z")
  }
})
test("三端的空心环排除整个身体都在内圈里的目标", () => {
  const area = { type: "area", at: 0, shape: { type: "arc", reach: 5, inner: 2, low: -1, high: 2, angle: 360 }, hits: "everyone", damage: 4, knockback: 0, effects: [] }
  const doc = AbilityAssetDocumentSchema.parse({ ...fireball, hits: [area] })
  expect(refused({ ...doc, hits: [{ ...area, shape: { ...area.shape, inner: 5 } }] })).toContain("内圈")
  for (const target of Object.keys(CLASSPATH) as TargetId[]) {
    const generated = compileAbilityCast({ modId: "test", packageName: "test.demo", abilities: [{ id: CAST_SAMPLE_IDS.frost, document: doc }], gestures: [], sounds: {} }, genTarget(target))
    expect(Object.values(generated.files).join(" ")).toContain("flat + wide <= shape[4]")
  }
})

test("踩踏绑定在三个目标注册踏步方法，右键绑定沿用原触发", () => {
  const doc = AbilityAssetDocumentSchema.parse({ ...fireball, bindings: [{ type: "block", block: "trap", trigger: "step", who: "living" }] })
  for (const target of Object.keys(CLASSPATH) as TargetId[]) {
    const generated = compileAbilityCast({ modId: "test", packageName: "test.demo", abilities: [{ id: CAST_SAMPLE_IDS.frost, document: doc }], gestures: [], sounds: {} }, genTarget(target))
    expect(Object.keys(generated.files).some(key => key.endsWith("/StudioAbilityStep.java"))).toBe(true)
    expect(Object.values(generated.files).join(" ")).toContain("STEP = {2}")
    expect(generated.patch["src/main/resources/test.mixins.json"]?.('{"mixins":[]}')).toContain("StudioAbilityStep")
  }
})

test("玩家和方块在三端用同一个落点释放地面特效与地形", () => {
  const place = { at: 0.5, where: "hit", hit: 0, forward: 0, left: 0 }
  const doc = AbilityAssetDocumentSchema.parse({ ...fireball, hits: [{ type: "area", at: 0.5, shape: { type: "sphere", radius: 2, forward: 0, up: 0, left: 0 }, hits: "everyone", damage: 1, knockback: 0, effects: [] }],
    events: [
      { ...place, type: "crack", radius: 3, seconds: 1, grow_seconds: 0.3, glow: true, color: "#8899ff" },
      { ...place, type: "shockwave", from_radius: 1, to_radius: 4, seconds: 0.6, width: 0.5, height: 1, color: "#99ccff", glow: true, damage: 2, knockback: 0, hits: "everyone", effects: [] },
      { ...place, type: "break", up: 0, radius: 1, height: 1, hardness: 2, drops: false },
      { ...place, type: "terrain_rise", shape: "spike", width: 2, height: 2, rise_seconds: 0.5, stay_seconds: 2, lifts: true, shatter: true },
      { type: "beam", at: 0.5, until: 1.5, forward: 0, up: 1, left: 0, aim: "ahead", turn: 0, length: 6, width: 0.3, color: "#99ccff", damage: 2, hits: "everyone", effects: [], every_ticks: 10 },
    ] })
  for (const target of Object.keys(CLASSPATH) as TargetId[]) {
    const made = compileAbilityCast({ modId: "test", packageName: "test", abilities: [{ id: CAST_SAMPLE_IDS.frost, document: doc }], gestures: [], sounds: {} }, genTarget(target))
    const java = Object.values(made.files).join("\n")
    for (const word of ["c.emitHits.getOrDefault(0", "StudioBreak.smash(server", "StudioFx.start(c.world", "StudioTerrain.rise(c.world", "StudioFx.castBeam(c.world"]) expect(java).toContain(word)
    expect(java).not.toContain("StudioTerrain.rise(level()")
  }
})

test("两只生物各自换动作、部件、声音、粒子和伤害", () => {
  const skill = AbilityAssetDocumentSchema.parse({
    ...fireball, bindings: [], particles: { sparks: "flame" },
    hits: [{ type: "area", at: 0.2, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 2 }, hits: "everyone", bone: "weapon", damage: 4, knockback: 0, effects: [] }],
    events: [{ type: "particle", at: 0.2, particle: { alias: "sparks" }, bone: "weapon", forward: 0, up: 0, left: 0, spread: 0, count: 2 }, { type: "sound", at: 0.2, sound: "entity.blaze.shoot", sound_alias: "impact", volume: 1, pitch: 1 }],
  })
  const use = { id: "slam", clip: "smash", facing: "lock" as const, asset: CAST_SAMPLE_IDS.fireball, stopped_by_hurt: false, start: { min_distance: 0, max_distance: 8, cooldown: 2, weight: 1, line_of_sight: false } }
  expect(sharedAbilityInline(use, skill).ability?.hits[0]).toMatchObject({ damage: 4, bone: "weapon" })
  const other = sharedAbilityInline({ ...use, clip: "spin", bones: { weapon: "tail" }, particles: { sparks: "snowflake" }, sounds: { impact: "entity.iron_golem.attack" }, damage_scale: 1.5, cooldown: 3 }, skill)
  expect(other.ability).toMatchObject({ clip: "spin", start: { cooldown: 3 }, hits: [{ damage: 6, bone: "tail" }], events: [{ particle: "snowflake", bone: "tail" }, { sound: "entity.iron_golem.attack" }] })
})

test("a channel ramps its loop sound through its last tick", () => {
  const document = AbilityAssetDocumentSchema.parse({ ...frostBreath, loop_pitch: { from: 0.8, to: 1.4 } })
  expect(refused({ ...document, sounds: {} })).toContain("sounds.loop")
  for (const target of Object.keys(CLASSPATH) as TargetId[]) {
    const made = compileAbilityCast({ modId: "test", packageName: "test", abilities: [{ id: CAST_SAMPLE_IDS.frost, document }], gestures: [], sounds: {} }, genTarget(target))
    expect(Object.values(made.files).join("\n")).toContain("LOOP_TO = {1.4f}")
  }
})

test("release charging requires a held item and a reachable minimum", () => {
  const cast = { ...tripleBolt.cast, release: { min_seconds: 0.2 } }
  expect(refused({ ...tripleBolt, cast })).toBe("")
  expect(refused({ ...tripleBolt, cast: { ...cast, release: { min_seconds: 2 } } })).toContain("最短蓄力")
  expect(refused({ ...tripleBolt, cast, bindings: [{ type: "item", item: "staff", use: "click" }] })).toContain("hold")
})

test("the four examples parse, and what the fields cannot say is refused with a reason", () => {
  for (const document of [frostBreath, renewal, tripleBolt, fireball]) expect(AbilityAssetDocumentSchema.parse(document)).toEqual(document)
  expect(refused({ ...fireball, cast: { ...fireball.cast, seconds: 1 } })).toContain("瞬发")
  expect(refused({ ...frostBreath, cast: { ...frostBreath.cast, tick_every: undefined } })).toContain("tick_every")
  expect(refused({ ...frostBreath, cast: { ...frostBreath.cast, tick_every: 5 } })).toContain("至少写 10")
  expect(refused({ ...frostBreath, hits: [{ ...frostBreath.hits[0], at: 0.6 }] })).toContain("要早于 10 刻")
  expect(refused({ ...renewal, hits: [{ ...renewal.hits[0], damage: 2 }] })).toContain("不能伤人")
  expect(refused({ ...renewal, hits: [{ ...renewal.hits[0], effects: [{ effect: "poison", duration_ticks: 20, amplifier: 0 }] }] })).toContain("坏效果")
  expect(refused({ ...frostBreath, hits: [{ ...frostBreath.hits[0], heal: 2 }] })).toContain("只给自己人")
  expect(refused({ ...fireball, bindings: [{ type: "item", item: "ember_tome", use: "hold" }] })).toContain("click")
  expect(refused({ ...fireball, bindings: [...fireball.bindings, ...fireball.bindings] })).toContain("只绑一次")
  expect(refused({ ...frostBreath, scaling: undefined })).toContain("scaling")
  expect(refused({ ...fireball, scaling: { scales_with: ["level"] } })).toContain("没有任何数值")
  expect(refused({ ...frostBreath, scaling: { scales_with: ["attribute:generic"] } })).toContain("attribute:")
  expect(refused({ ...frostBreath, hits: [{ ...frostBreath.hits[0], place: "target" }] })).toContain("sphere")
  expect(refused({ ...tripleBolt, hits: [{ ...tripleBolt.hits[0], damage: null }] })).toContain("箭要写伤害")
  // A number that grows is held to its bounds at any level, as the runtime holds it.
  expect(scaledAt({ base: 5, per_level: -0.05 }, 30, 0, 600)).toBeCloseTo(3.5)
  expect(scaledAt({ base: 5, per_level: -0.05 }, 1000, 0, 600)).toBe(0)
})

test("the kind is registered, guided with three playable examples, and reviewed by its words", () => {
  expect(ModuleKindSchema.options).toContain("ability")
  expect(MODULES.ability.label).toBe("技能")
  expect(MODULES.ability.root).toBe(true)
  expect(ASSET_STANDARDS.ability.kind).toBe("ability")
  for (const words of ["环形震地", "冰刺法杖", "地刺陷阱", "shared_abilities", "scales_with", "cancel_on", "config/<模组 id>-abilities.properties"]) expect(ABILITY_ASSET_INSTRUCTIONS).toContain(words)
  // Every example the guide writes is a document the schema takes.
  const examples = [...ABILITY_ASSET_INSTRUCTIONS.matchAll(/(\{"kind":"ability".*?\})(?=[；。])/g)].map((found) => JSON.parse(found[1]!))
  expect(examples.length).toBe(3)
  examples.forEach((example) => expect(refused(example)).toBe(""))
  // No third party is named anywhere the AI reads.
  expect(abilityAssetLines(tripleBolt).join("")).toContain("0 级时冷却 5 秒、伤害 6、伤害 6、伤害 6；10 级时冷却 4.5 秒、伤害 8.5、伤害 8.5、伤害 8.5")
})

test("a creature uses a shared ability as one of its own; what only a player's spell has is refused", () => {
  const use = { asset: CAST_SAMPLE_IDS.fireball, id: "fireball", clip: "burst", windup: 0.6, facing: "track" as const, start: { min_distance: 3, max_distance: 16, line_of_sight: true, cooldown: 4, weight: 3 }, stopped_by_hurt: false }
  const made = sharedAbilityInline(use, fireball)
  expect(made.reason).toBeNull()
  expect(made.ability).toMatchObject({ id: "fireball", name: "火球术", clip: "burst", windup: 0.6, length: 0.65, hits: [{ type: "shot", at: 0.6, projectile: "small_fireball", damage: null }], events: [{ type: "sound", at: 0.6, sound: "entity.blaze.shoot" }] })
  // A channel is its timeline once for every pulse; numbers that grow are at their base.
  const breath = sharedAbilityInline({ ...use, id: "breath", windup: undefined }, frostBreath)
  expect(breath.ability?.hits.map((hit) => hit.at)).toEqual([0, 0.5, 1, 1.5, 2, 2.5])
  expect(breath.ability?.hits.every((hit) => hit.type === "area" && hit.damage === 2)).toBe(true)
  expect(breath.ability?.length).toBe(3)
  expect(sharedAbilityInline(use, renewal).reason).toContain("只打自己人")
  // More than a creature's ability may hold is said.
  expect(sharedAbilityInline(use, { ...tripleBolt, hits: [...tripleBolt.hits, ...tripleBolt.hits, ...tripleBolt.hits, ...tripleBolt.hits] } as AbilityAssetDocument).reason).toContain("最多 10 次")
})

test("the project's checks: what it is bound to is there and bound once, a creature's use of it can be one of its abilities", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-cast-checks-"))
  roots.push(root)
  const project = await createTargetCastSample(path.join(root, "霜火工坊"), "forge-1.20.1")
  const asset = (id: string) => ({ id, document: project.workspace.assets.find((value) => value.id === id)!.document as AbilityAssetDocument })
  const noSkills = { ...project, workspace: { assets: project.workspace.assets.filter((value) => value.module !== "ability") } }
  const before = playFindings(noSkills).filter((finding) => finding.about?.kind === "item" && finding.text.includes("没有任何用处"))
  expect(before.length).toBeGreaterThan(0)
  expect(playFindings(project).filter((finding) => before.some((old) => old.about?.id === finding.about?.id) && finding.text.includes("没有任何用处"))).toEqual([])
  const blockUses = (given: typeof project) => projectThings(given).find((thing) => thing.names?.includes("renewal_totem"))?.answers.flatMap((answer) => answer.question === "use" ? [answer.words] : []) ?? []
  expect(blockUses(noSkills).join("")).not.toContain("施放技能")
  expect(blockUses(project).join("")).toContain("方块会施放技能")
  expect(abilityAssetIssues(project, asset(CAST_SAMPLE_IDS.frost), "1.20.1")).toEqual([])
  expect(sharedAbilityIssues(project)).toEqual([])
  // The creature is built and checked with the fireball among its own abilities.
  expect(withSharedAbilities(project).entities[0]!.abilities?.map((ability) => ability.id)).toEqual(["fireball"])
  const gone = { ...asset(CAST_SAMPLE_IDS.frost), document: { ...frostBreath, bindings: [{ type: "item" as const, item: "nothing_here", use: "hold" as const }, { type: "block" as const, block: "renewal_totem" }] } }
  const texts = abilityAssetIssues(project, gone, "1.20.1").map((issue) => issue.text)
  expect(texts.some((text) => text.includes("选的物品在这个工程里找不到"))).toBe(true)
  expect(texts.some((text) => text.includes("同时绑了技能「霜息」和「回春」"))).toBe(true)
  // What 1.20.1's game lacks is refused for it, and not for 1.21.1.
  const breeze = { ...asset(CAST_SAMPLE_IDS.fireball), document: { ...fireball, events: [{ type: "sound" as const, at: 0, sound: "entity.breeze.shoot", volume: 1, pitch: 1 }] } }
  expect(abilityAssetIssues(project, breeze, "1.20.1").map((issue) => issue.text).join("")).toContain("1.20.1 里还没有")
  expect(abilityAssetIssues(project, breeze, "1.21.1")).toEqual([])
  // A creature that names an ability only a player's spell can be is said and not built.
  const healing = { ...project, entities: project.entities.map((entity) => ({ ...entity, shared_abilities: entity.shared_abilities!.map((use) => ({ ...use, asset: CAST_SAMPLE_IDS.renewal })) })) }
  expect(sharedAbilityIssues(healing).map((issue) => issue.text).join("")).toContain("当不了它的招式")
  const findings = reconcile(healing, { animations: { [project.entities[0]!.id]: ["idle", "walk", "hurt", "slam", "burst"] }, built: null } as never)
  expect(findings.filter((finding) => finding.rule === "ability_asset").map((finding) => finding.about?.kind)).toEqual(["entity"])
  // The workspace holds the links: a creature that uses an ability asset depends on it.
  const workspace = { assets: project.workspace.assets.map((value) => (value.document.kind === "ability" && value.id === CAST_SAMPLE_IDS.frost ? { ...value, document: { ...frostBreath, gesture: "ab111111-0000-4000-8000-0000000000ff" } } : value)) }
  expect(WorkspaceSchema.safeParse(workspace).error?.issues.map((issue) => issue.message).join(" ")).toContain("Ability asset must depend on every gesture workspace asset it names")
})

test("the runtime: each ability's tables and timeline, the gesture runtime's two hooks, and nothing for a project that binds none", () => {
  const abilities = [frostBreath, renewal, tripleBolt, fireball].map((document, index) => ({ id: Object.values(CAST_SAMPLE_IDS)[index]!, document }))
  const made = compileAbilityCast({ modId: "frost_hearth", packageName: "com.minemods.content_frost_hearth", abilities, gestures: [], sounds: {} })
  const table = String(made.files[`src/main/java/com/minemods/content_frost_hearth/ability/${ABILITY_CAST.table}.java`])
  expect(table).toContain("public static final int[] TYPE = {2, 0, 1, 0};")
  expect(table).toContain("public static final int[] CAST_TICKS = {60, 0, 24, 0};")
  expect(table).toContain("static final int[] EVERY = {10, 1, 1, 1};")
  expect(table).toContain('public static final String[] ITEMS = {"frost_wand", "charged_crossbow", "ember_tome"};')
  expect(table).toContain("public static final boolean[] ITEM_HOLD = {true, true, false};")
  expect(table).toContain('static final String[][] ATTRIBUTES = {{}, {}, {"minecraft:generic.attack_damage"}, {}};')
  expect(table).toContain("static final boolean[] CANCEL_MOVE = {true, false, false, false};")
  expect(table).toContain("float damage = (float) (scaled(2.0, 0.1, c.level, 0.0, 1024.0) * power);")
  expect(table).toContain("victim.addEffect(new MobEffectInstance(MobEffects.REGENERATION, 100, 0), c.owner);")
  expect(table).toContain("shot.setBaseDamage((float) (scaled(6.0, 0.25, c.level, 0.0, 1024.0) * power) / 3.0);")
  expect(table).toContain("Arrow shot = new Arrow(c.world, c.owner, new ItemStack(Items.ARROW), null);")
  // Fabric: its entry points, and the facade the runtime is written against; the HUD and tooltips through Fabric's callbacks.
  expect(Object.keys(made.files)).toContain("src/main/java/com/minemods/content_frost_hearth/platform/StudioPlatform.java")
  expect(made.patch["src/main/resources/fabric.mod.json"]!('{"entrypoints":{"main":["a.B"]}}')).toContain("com.minemods.content_frost_hearth.ability.StudioAbilityFabricClient")
  expect(made.language.zh_cn["ability.frost_hearth.ab111111000040008000000000000003"]).toBe("三连弩")
  expect(made.language.en_us["tooltip.frost_hearth.ability.ab111111000040008000000000000003.more"]).toBe("Can be recast 2 more times within 4s; Interrupted by switching items")
  // Forge 1.20.1 and NeoForge 1.21.1: the facade entries run it; the HUD is an overlay or a layer of their own; 1.20.1's arrow and fireball.
  const forge = compileAbilityCast({ modId: "frost_hearth", packageName: "com.minemods.content_frost_hearth", abilities, gestures: [], sounds: {} }, genTarget("forge-1.20.1"))
  expect(forge.entries.common).toEqual(["com.minemods.content_frost_hearth.ability.StudioAbilities"])
  expect(String(forge.files[`src/main/java/com/minemods/content_frost_hearth/ability/${ABILITY_CAST.overlay}.java`])).toContain("RegisterGuiOverlaysEvent")
  expect(String(forge.files[`src/main/java/com/minemods/content_frost_hearth/ability/${ABILITY_CAST.table}.java`])).toContain("Arrow shot = new Arrow(c.world, c.owner);")
  const neo = compileAbilityCast({ modId: "frost_hearth", packageName: "com.minemods.content_frost_hearth", abilities, gestures: [], sounds: {} }, genTarget("neoforge-1.21.1"))
  expect(String(neo.files[`src/main/java/com/minemods/content_frost_hearth/ability/${ABILITY_CAST.overlay}.java`])).toContain("RegisterGuiLayersEvent")
  // The gesture runtime's hooks, on both its texts.
  for (const facade of [false, true]) {
    const file = `src/main/java/p/q/gesture/${facade ? "platform" : "fabric"}/GestureMod.java`
    const text = facade
      ? "    private static void play(ServerPlayer player, Play payload) {\n        if (!COOLDOWN.accept(player.getUUID(), gesture.lengthTicks(), player.getServer().getTickCount())) return;\n"
      : "    @Override public void onInitialize() {\n            if (!COOLDOWN.accept(player.getUUID(), gesture.lengthTicks(), context.server().getTickCount())) return;\n"
    const files: Record<string, string | Uint8Array> = { [file]: text }
    patchGestureRuntime(files, "p.q", facade, { show: true, keys: true })
    expect(String(files[file])).toContain("if (!p.q.ability.StudioAbilities.gesture(player, payload.gesture())) return;")
    expect(String(files[file])).toContain("public static void showFor(")
  }
  expect(() => compileAbilityCast({ modId: "frost_hearth", packageName: "com.minemods.content_frost_hearth", abilities: [], gestures: [], sounds: {} })).toThrow("ABILITY_CAST_NOTHING_BOUND")
})

test("a project whose ability assets are bound to nothing builds as if it had none", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-cast-unbound-"))
  roots.push(root)
  const directory = path.join(root, "霜火工坊")
  const project = await createTargetCastSample(directory, "fabric-1.21.1")
  const tree = async (name: string) => {
    const source = path.join(root, name)
    await mkdir(source)
    await assembleBuildSource(directory, source, TEMPLATE)
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && !entry.parentPath.includes("project-backup") && entry.name !== "minemods-build.json").map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)))
    return Object.fromEntries(await Promise.all(names.sort().map(async (name) => [name, await readFile(path.join(source, name), "utf8")] as const)))
  }
  // Unbound, and no creature uses one: the ability assets are drafts the build does not take.
  const unbound = { ...project, entities: project.entities.map((entity) => ({ ...entity, shared_abilities: null })), workspace: { assets: project.workspace.assets.map((asset) => (asset.document.kind === "ability" ? { ...asset, document: { ...asset.document, bindings: [] } } : asset)) } }
  await saveProject(directory, unbound, project.revision)
  const drafts = await tree("drafts")
  const none = { ...unbound, revision: unbound.revision + 1, workspace: { assets: unbound.workspace.assets.filter((asset) => asset.document.kind !== "ability") } }
  await saveProject(directory, none, (await openProject(directory)).revision)
  const without = await tree("without")
  expect(Object.keys(drafts)).toEqual(Object.keys(without))
  // Only the guide beside the source differs: it lists the drafts the build left out.
  expect(Object.keys(drafts).filter((name) => drafts[name] !== without[name])).toEqual(["README-STUDIO.md"])
  expect(Object.keys(drafts).some((name) => name.includes(`${path.sep}ability${path.sep}`) || name.includes(`${path.sep}platform${path.sep}`))).toBe(false)
}, 120000)

test("a build stops on an ability bound to an item the project does not have", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-cast-stop-"))
  roots.push(root)
  const directory = path.join(root, "霜火工坊")
  const project = await createTargetCastSample(directory, "fabric-1.21.1")
  await saveProject(directory, { ...project, workspace: { assets: project.workspace.assets.map((asset) => (asset.id === CAST_SAMPLE_IDS.fireball && asset.document.kind === "ability" ? { ...asset, document: { ...asset.document, bindings: [{ type: "item" as const, item: "lost_tome", use: "click" as const }] } } : asset)) } }, project.revision)
  const source = path.join(root, "source")
  await mkdir(source)
  const stopped = await assembleBuildSource(directory, source, TEMPLATE).then(() => null, (error: unknown) => error)
  expect(stopped).toBeInstanceOf(BuildStop)
  expect((stopped as BuildStop).rule).toBe("ability_asset")
  expect((stopped as BuildStop).message).toContain("火球术」选的物品在这个工程里找不到")
  expect((stopped as BuildStop).findings[0]?.detail).toBe("lost_tome")
})

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: an item's held channel, a block's cast and a creature's shared fireball are assembled by Studio's own build and compile against the real class path`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-cast-tree-"))
    roots.push(root)
    await createTargetCastSample(path.join(root, "霜火工坊"), target)
    const source = path.join(root, "source")
    await mkdir(source)
    const built = await assembleBuildSource(path.join(root, "霜火工坊"), source, TEMPLATE)
    expect(built.abilityFiles).toContain(`com/minemods/content_frost_hearth/ability/${ABILITY_CAST.table}.class`)
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".java")).map((entry) => path.join(entry.parentPath, entry.name))
    const creatures = await Promise.all(names.filter((name) => /StudioCreature\w*\.java$/.test(name) && !/Renderer|Model/.test(name)).map((name) => readFile(name, "utf8")))
    // The creature throws the shared fireball as its own ability, by the creature runtime.
    expect(creatures.some((text) => text.includes("SmallFireball shot = new SmallFireball(level(), this, aim"))).toBe(true)
    const lang = JSON.parse(await readFile(path.join(source, "src/main/resources/assets/frost_hearth/lang/en_us.json"), "utf8"))
    expect(lang["ability.frost_hearth.ab111111000040008000000000000001"]).toBe("Frost Breath")
    expect(lang["tooltip.frost_hearth.ability.use.channel_hold"]).toBe("Hold right-click to channel, up to %ss")
    if (target === "fabric-1.21.1") expect(JSON.parse(await readFile(path.join(source, "src/main/resources/fabric.mod.json"), "utf8")).entrypoints.client).toContain(`com.minemods.content_frost_hearth.ability.${ABILITY_CAST.fabricClient}`)
    else expect(await readFile(path.join(source, "src/main/java/com/minemods/content_frost_hearth/StudioContent.java"), "utf8")).toContain(`com.minemods.content_frost_hearth.ability.${ABILITY_CAST.table}.register();`)
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

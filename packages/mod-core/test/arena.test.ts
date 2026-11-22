import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { ARENA_ABILITY_INSTRUCTIONS, ARENA_INSTRUCTIONS, ARENA_LIMITS, ArenaFogSchema, ArenaSchema, arenaCoverage, arenaDocumentIssues, arenaPlan, arenaReviewIssues, arenaWords, fogStages, leaveWords, plainShape } from "../src/arena"
import { ABILITY_INSTRUCTIONS, abilityHitShapes, abilityWords, hitPlaces, shapeRange } from "../src/creature-abilities"
import { BOSS_INSTRUCTIONS, bossModelIssues } from "../src/creature-boss"
import { AbilitySchema, BossSchema, creatureDocumentIssues, hitPlace, type Ability } from "../src/entity-runtime"
import { ARENA_RUNTIME, compileArena } from "../src/fabric/arena"
import { ABILITY_WARN } from "../src/fabric/ability-warn"
import { compileBoss } from "../src/fabric/entity-boss"
import { bossPlan } from "../src/creature-boss"
import { compileAbilities } from "../src/fabric/entity-abilities"
import { effectName } from "../src/effect"
import { FixtureDocumentSchema, fixtureBox, fixtureLines } from "../src/fixture"
import { genTarget } from "../src/platform/target"
import { WorkspaceSchema } from "../src/workspace"
import { MODULES } from "../src/workspace-modules"
import type { TargetId } from "../src/target/ids"
import { ARENA_SAMPLE_IDS, chiyouDesign, compassFixture, createTargetArenaSample, fogAbility, zhuoluAbility } from "../script/target-arena-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * Boss 能力 12 (场地物件 + 雾) and 13 (涿鹿): the arena's document, plan, words and checks; the fixture asset; what a build writes for them on every target and that
 * the whole tree compiles on each target's real class path. The real servers are `script/target-arena-check.ts`.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const LOADER_API = /^import net\.(minecraftforge|neoforged|fabricmc)\./m
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const arena = { fixtures: [{ id: "compass", look: { asset: ARENA_SAMPLE_IDS.compass }, place: { ring: { count: 4, radius: 10 } }, use: { seconds: 1, cooldown: 3 }, clear: { radius: 6, seconds: 30 } }], fog: { visibility: 6, fade_seconds: 1, boss_damage: 1.5, damage_taken: 0.5, lift: "all_lit_once" as const } }
const boss = (more: Record<string, unknown> = {}) => BossSchema.parse({ bar: { color: "red", style: "progress", darken_sky: false }, intro: null, phases: [], death: { seconds: 2, xp_bursts: 0, explosion: false }, leash: null, arena, ...more })

test("an optional fog fade end can extend the fade after visibility", () => {
  expect(ArenaFogSchema.parse(arena.fog)).not.toHaveProperty("fade_end")
  expect(ArenaFogSchema.parse({ ...arena.fog, fade_end: 36 }).fade_end).toBe(36)
  expect(ArenaFogSchema.safeParse({ ...arena.fog, fade_end: 5 }).error?.issues[0]?.path).toEqual(["fade_end"])
  expect(ArenaFogSchema.safeParse({ ...arena.fog, fade_end: 65 }).success).toBe(false)
})

test("an arena: fixtures by place or ring, at most eight in all, ids once; the plan lays a ring out from ahead round to the left, its middle the middle of them all", () => {
  expect(ArenaSchema.safeParse(arena).success).toBe(true)
  const crowded = ArenaSchema.safeParse({ ...arena, fixtures: [arena.fixtures[0], { ...arena.fixtures[0], id: "more", place: { ring: { count: 5, radius: 6 } } }] })
  expect(crowded.error?.issues[0]?.message).toContain("一个场地最多 8 座物件")
  expect(ArenaSchema.safeParse({ ...arena, fixtures: [arena.fixtures[0], arena.fixtures[0]] }).error?.issues[0]?.message).toContain("两组场地物件不能用同一个 id")
  const plan = arenaPlan(arena)
  expect(plan.fixtures.map((fixture) => [fixture.id, fixture.forward, fixture.left])).toEqual([["compass_1", 10, 0], ["compass_2", 0, 10], ["compass_3", -10, 0], ["compass_4", 0, -10]])
  expect(plan.center).toEqual({ forward: 0, left: 0 })
  const single = arenaPlan({ fixtures: [{ ...arena.fixtures[0]!, id: "torch", place: { forward: 6, left: -2 } }] })
  expect(single.fixtures).toMatchObject([{ id: "torch", forward: 6, left: -2 }])
  expect(single.center).toEqual({ forward: 6, left: -2 })
})

test("a fixture asset: its two motions are its own, its box is what its model stands; the words say what it plays and when it glows", () => {
  expect(FixtureDocumentSchema.safeParse({ ...compassFixture, play: { ...compassFixture.play, lit: "spin" } }).error?.issues[0]?.message).toContain("play.lit 写的是 spin")
  expect(fixtureBox(compassFixture)).toEqual({ width: 0.875, height: 1.313 })
  expect(fixtureLines(compassFixture).join()).toContain("没点亮时播「dark」（循环），点亮时播「lit」（循环）")
  expect(fixtureLines(compassFixture).join()).toContain("点亮的时候发光")
  expect(MODULES.fixture).toMatchObject({ label: "场地物件", staged: true })
  expect(MODULES.entity.references.some((reference) => reference.field === "boss.arena" && reference.kinds.includes("fixture"))).toBe(true)
})

test("an ability's fog, leave, hit over the arena and its safe places: refused where they cannot be played, said where they can", () => {
  const hostile = { behavior: "hostile", abilities: [fogAbility, zhuoluAbility] }
  expect(creatureDocumentIssues({ ...hostile, boss: boss() } as never)).toEqual([])
  // Without a boss none of them; without a fog no fog event; a flier cannot leave.
  const plain = arenaDocumentIssues({ ...hostile, boss: null } as never).map((issue) => issue.message)
  expect(plain.join()).toContain("起雾（fog）只有 Boss 能用")
  expect(plain.join()).toContain("离场（leave）只有 Boss 能用")
  expect(plain.join()).toContain("shape: arena")
  expect(plain.join()).toContain('over: "center"')
  expect(arenaDocumentIssues({ ...hostile, boss: boss({ arena: { ...arena, fog: null } }) } as never).map((issue) => issue.message).join()).toContain("boss.arena 没有写 fog")
  expect(arenaDocumentIssues({ ...hostile, boss: boss(), flight: {} } as never).map((issue) => issue.message).join()).toContain("会飞的 Boss")
  const late = AbilitySchema.parse({ ...zhuoluAbility, moves: [{ type: "leave", at: 2, rise: 16, back: { at: 1, place: "home" } }] })
  expect(arenaDocumentIssues({ behavior: "hostile", boss: boss(), abilities: [late] } as never).map((issue) => issue.message).join()).toContain("要比离开（at，第 2 秒）晚")
  // A safe ground round lit fixtures needs fixtures, and only a hit over the arena has one.
  expect(arenaDocumentIssues({ ...hostile, boss: boss({ arena: { fixtures: [], fog: arena.fog } }) } as never).map((issue) => issue.message).join()).toContain("lit_fixtures")
  const safeElsewhere = AbilitySchema.parse({ ...fogAbility, hits: [{ ...fogAbility.hits[0], safe: { around: "lit_fixtures", radius: 3 } }] })
  expect(arenaDocumentIssues({ behavior: "hostile", boss: boss(), abilities: [safeElsewhere] } as never).map((issue) => issue.message).join()).toContain("安全区（safe）只写在打整个场地的那一下上")
  // The hit over the arena is counted from the arena's middle, as the full circle the fight is.
  const hit = zhuoluAbility.hits[1]!
  expect(hitPlace(hit as never)).toBe("center")
  expect(plainShape((hit as unknown as { shape: never }).shape)).toEqual({ type: "arc", reach: ARENA_LIMITS.radius, angle: 360, low: -2, high: 6 })
  expect(shapeRange((hit as unknown as { shape: never }).shape)).toBe(ARENA_LIMITS.radius + 1)
  expect(hitPlaces(hit, 1, 6)).toEqual([{ forward: 0, up: 0, left: 0 }])
  const words = [...zhuoluAbility.hits.map((value) => abilityWords.hit(value)), abilityWords.events(fogAbility)].join("；")
  expect(words).toContain("在场地正中各打整个场地（场地正中周围 32 格，离地 -2 到 6 格）")
  expect(words).toContain("亮着的场地物件周围 4 格内的人不受伤")
  expect(words).toContain("往场地正中落下")
  expect(words).toContain("放大到 3 倍")
  expect(words).toContain("第 0.4 秒起雾")
  expect(leaveWords(zhuoluAbility.moves[0] as never)).toBe("第 0.4 秒升到半空 16 格消失（这段时间看不见、打不到、不会被当成目标，血条还在），第 8 秒落回场地正中（物件围成的那一圈的中间，没有物件就是家）")
  const shapes = abilityHitShapes(zhuoluAbility as Ability, chiyouDesign as never)!
  expect(shapes.length).toBeGreaterThan(0)
})

test("the reviewer: the arena's facts and what will not play the way it reads", () => {
  expect(fogStages(boss(), [fogAbility, zhuoluAbility])).toEqual([0])
  const said = arenaReviewIssues({ name: "蚩尤", boss: boss(), abilities: [fogAbility, zhuoluAbility] })
  expect(said.map((issue) => issue.text).join()).toContain("能起雾的招式在第一阶段能出")
  expect(said.some((issue) => issue.stops)).toBe(false)
  // Overlapping clear grounds, a ring at the edge of the fight's range, a clear ground smaller than the fog lets one see anyway, no warning and no safe ground.
  const crowded = { fixtures: [{ ...arena.fixtures[0]!, place: { ring: { count: 4, radius: 31 } }, clear: { radius: 5, seconds: 20 } }, { ...arena.fixtures[0]!, id: "near", place: { forward: 2, left: 0 } }], fog: arena.fog }
  const bare = AbilitySchema.parse({ ...zhuoluAbility, hits: [{ type: "area", at: 4, shape: { type: "arena", low: -2, high: 6 }, hits: "everyone", damage: 20, knockback: 0, effects: [] }] })
  const texts = arenaReviewIssues({ name: "蚩尤", boss: boss({ arena: crowded }), abilities: [bare] }).map((issue) => issue.text).join("\n")
  expect(texts).toContain("在战斗范围（32 格）的边上或外面")
  expect(texts).toContain("清出来的地方（半径 5 格）还没有雾里本来看得见的远（6 格）")
  expect(texts).toContain("没有一个它能出的招式会起雾")
  expect(texts).toContain("可是没有预警")
  expect(texts).toContain("却没有安全区")
  expect(arenaCoverage(arenaPlan({ fixtures: [{ ...arena.fixtures[0]!, place: { ring: { count: 4, radius: 10 } }, clear: { radius: 30, seconds: 20 } }] }))).toBeGreaterThan(0.6)
  // The boss's own model check carries them.
  expect(bossModelIssues({ name: "蚩尤", behavior: "hostile", abilities: [bare], boss: boss({ arena: crowded }) } as never, null).some((issue) => issue.rule === "boss_arena")).toBe(true)
  expect(arenaWords(arena)).toContain("它醒来时在家周围的地面上摆好 4 座场地物件")
})

test("what an AI is told: the arena with the boss, the fog, leave, arena hit, safe places, the middle and size with the abilities", () => {
  expect(BOSS_INSTRUCTIONS).toContain(ARENA_INSTRUCTIONS)
  expect(ABILITY_INSTRUCTIONS).toContain(ARENA_ABILITY_INSTRUCTIONS)
  for (const word of ['{type:"fog", at}', '{type:"leave"', '{type:"arena", low, high}', 'safe:{around: "lit_fixtures"', '"center"', "size"]) expect(`${ARENA_INSTRUCTIONS}${ARENA_ABILITY_INSTRUCTIONS}`).toContain(word)
})

test("a workspace: an entity whose arena puts a fixture down depends on it, and it is a fixture", () => {
  const now = new Date().toISOString()
  const asset = (id: string, module: string, document: unknown, dependencies: string[] = []) => ({ id, module, title: id, revision: 1, created_at: now, updated_at: now, prompt: id, dependencies, document, provenance: { model: "example", request_id: null }, status: "ready" })
  const fixture = asset(ARENA_SAMPLE_IDS.compass, "fixture", compassFixture)
  expect(WorkspaceSchema.safeParse({ assets: [fixture] }).success).toBe(true)
})

test("the arena's classes: Fabric's packet, tick, fixtures and client are its own and named in fabric.mod.json; a facade target's go through the facade; the fog's mixin is client-only, the hurt's common", () => {
  const pkg = "src/main/java/com/minemods/content_zhuolu_field"
  const fixtures = [{ id: ARENA_SAMPLE_IDS.compass, title: "指南车", document: compassFixture }]
  const fabric = compileArena({ modId: "zhuolu_field", packageName: "com.minemods.content_zhuolu_field", fixtures })
  expect(Object.keys(fabric.files).filter((name) => name.endsWith(".java")).sort()).toEqual(
    [`${pkg}/client/${ARENA_RUNTIME.client}.java`, `${pkg}/client/${ARENA_RUNTIME.renderer}.java`, `${pkg}/entity/${ARENA_RUNTIME.server}.java`, `${pkg}/entity/${ARENA_RUNTIME.fixture}.java`, `${pkg}/entity/${ARENA_RUNTIME.table}.java`, `${pkg}/mixin/${ARENA_RUNTIME.fog}.java`, `${pkg}/mixin/${ARENA_RUNTIME.hurt}.java`].sort(),
  )
  const name = `fixture_${ARENA_SAMPLE_IDS.compass.replaceAll("-", "")}`
  expect(Object.keys(fabric.files)).toEqual(expect.arrayContaining([`src/main/resources/assets/zhuolu_field/geo/${name}.geo.json`, `src/main/resources/assets/zhuolu_field/textures/entity/${name}_glowmask.png`]))
  const animations = JSON.parse(String(fabric.files[`src/main/resources/assets/zhuolu_field/animations/${name}.animation.json`]))
  expect(Object.keys(animations.animations).sort()).toEqual([`animation.${name}.dark`, `animation.${name}.lit`])
  const metadata = JSON.parse(fabric.patch["src/main/resources/fabric.mod.json"]!(JSON.stringify({ entrypoints: { main: ["a.Main"], client: [] } })))
  expect(metadata.entrypoints).toEqual({ main: ["a.Main", "com.minemods.content_zhuolu_field.entity.StudioFixtures", "com.minemods.content_zhuolu_field.entity.StudioArena"], client: ["com.minemods.content_zhuolu_field.client.StudioArenaClient"] })
  expect(JSON.parse(fabric.patch["src/main/resources/zhuolu_field.mixins.json"]!(JSON.stringify({ mixins: [], client: ["Other"] })))).toMatchObject({ mixins: [ARENA_RUNTIME.hurt], client: ["Other", ARENA_RUNTIME.fog] })
  const table = String(fabric.files[`${pkg}/entity/${ARENA_RUNTIME.table}.java`])
  expect(table).toContain('public static final int[] GLOW = {1};')
  expect(table).toContain("public static final float[] WIDTH = {0.875f};")
  for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
    const facade = compileArena({ modId: "zhuolu_field", packageName: "com.minemods.content_zhuolu_field", fixtures }, genTarget(target))
    expect(Object.entries(facade.files).some(([name, text]) => name.endsWith(".java") && LOADER_API.test(String(text)))).toBe(false)
    expect(String(facade.files[`${pkg}/entity/${ARENA_RUNTIME.server}.java`])).toContain('StudioPlatform.s2c("studio_fog", Fog.class, Fog::write, Fog::read)')
    expect(String(facade.files[`${pkg}/client/${ARENA_RUNTIME.client}.java`])).toContain("StudioClientPlatform.onS2C(StudioArena.CHANNEL, fog -> told(fog.on(), fog.visibility(), fog.fade()));")
    expect(JSON.parse(facade.patch["src/main/resources/zhuolu_field.mixins.json"]!(JSON.stringify({ mixins: [], client: [] })))).toMatchObject({ mixins: [ARENA_RUNTIME.hurt], client: [ARENA_RUNTIME.fog] })
    expect(facade.entries).toEqual({ common: ["com.minemods.content_zhuolu_field.entity.StudioFixtures"], client: ["com.minemods.content_zhuolu_field.client.StudioArenaClient"] })
  }
})

test("an ability's fog, leave and hit over the arena as the Java its class runs; an ability without them is written as it always was", () => {
  const made = compileAbilities({ entity: "StudioCreature", model: "creature_x", abilities: [fogAbility, zhuoluAbility], hostile: true, runtime: true, death: false, boss: { tracker: "" } })
  expect(made.methods).toContain("StudioArena.fog(this);")
  expect(made.methods).toContain("StudioArena.leave(this, 16.0);")
  expect(made.methods).toContain("StudioArena.back(this, 1, abilityTarget);")
  expect(made.methods).toContain("abilityPlaces[1] = StudioArena.center(this);")
  expect(made.methods).toContain("int place = StudioArena.inside(this, victim, abilityPlaces[1], -2.0, 6.0, 1, 4.0, new double[] {});")
  // Warned as the full circle it covers.
  expect(made.methods).toContain(`abilityWarn(1, 2, ${ARENA_LIMITS.radius}.0f, 180.0f, -2.0f, 6.0f, 0.0f, 0.0f, 0, 0, 40);`)
  // Its safe places shown as blue rings while its warning shows.
  expect(made.methods).toContain("StudioArena.warnSafe(this, 40, 1, 4.0, new double[] {});")
  // 2026-11-20: a hit whose own warning is painted as a mesh has its safe rings painted the same way (a boss with every built-in swapped still drew ten thousand grains of dust round its lit fixtures).
  const meshed = AbilitySchema.parse({ ...zhuoluAbility, hits: zhuoluAbility.hits.map((hit) => (hit.type === "area" && hit.warn ? { ...hit, warn: { ...hit.warn, paint: "mesh" } } : hit)) })
  expect(compileAbilities({ entity: "StudioCreature", model: "creature_x", abilities: [fogAbility, meshed], hostile: true, runtime: true, death: false, boss: { tracker: "" } }).methods).toContain("StudioArena.warnSafe(this, 40, 1, 4.0, new double[] {}, true);")
  const plain = compileArena({ modId: "zhuolu_field", packageName: "com.minemods.content_zhuolu_field", fixtures: [], warned: true })
  const painted = compileArena({ modId: "zhuolu_field", packageName: "com.minemods.content_zhuolu_field", fixtures: [], warned: true, safeMesh: true })
  const server = (made: ReturnType<typeof compileArena>) => Object.entries(made.files).find(([name]) => name.endsWith("/StudioArena.java"))![1] as string
  expect(server(plain)).toContain("public static void warnSafe(Mob boss, int ticks, int safe, double radius, double[] points) {")
  expect(server(plain)).not.toContain("boolean mesh")
  expect(server(painted)).toContain("double[] points) { warnSafe(boss, ticks, safe, radius, points, false); }")
  expect(server(painted)).toContain(`ticks, mesh ? ${ABILITY_WARN.looks.ring + 8} : ${ABILITY_WARN.looks.ring}, `)
  expect(made.methods).toContain("StudioProjectiles.launch(this, abilityTarget, new StudioProjectiles.Spec(")
  // The comet bursts where it lands (落地炸开): the spike painted to glow, 24 embers of its own within 2 blocks, the screens within 32 blocks shaken for a second.
  expect(made.methods).toContain(', 4, 0, 0.0, new double[] {}, 24.0, 1, 0, "c3c3c3c3-0000-4000-8000-000000000002", null, new StudioProjectiles.Impact("c3c3c3c3-0000-4000-8000-000000000004", null, "c3c3c3c3-0000-4000-8000-000000000003", 24, 2.0, 3.0f, 32.0f, 20)), 0, 0.0, 0.0, 0.0, abilityYaw, 40, bossDamageScale(), 3.0f);')
})

test("a boss with an arena: its table, its tick, its reset and its own bar's dots; a boss without one is written as it always was", () => {
  const withArena = boss()
  const plan = bossPlan(withArena, [fogAbility, zhuoluAbility])
  const made = compileBoss({ entity: "StudioCreature", model: "creature_x", boss: withArena, plan, speed: 0.2, damage: 4, trackerElsewhere: true, interrupt: "", nbtElsewhere: false, bar: { creature: "creature_x", running: "abilityIndex", step: "-1" }, arena: { abilities: [fogAbility, zhuoluAbility], running: "abilityRunning()" } })
  expect(made.fields).toContain("private static final StudioArena.Spec ARENA = new StudioArena.Spec(")
  expect(made.methods).toContain("StudioArena.fight(this, bossBar, ARENA, !isDeadOrDying() && bossState() != BOSS_DORMANT, bossHomeX, bossHomeY, bossHomeZ, abilityRunning());")
  expect(made.methods).toContain("private void bossReset(boolean far) {\n        // Boss 能力 12、13: the fight is over")
  expect(made.methods).toContain("lit, phase, bossBarBroke, StudioArena.dots(this), StudioArena.litDots(this));")
  const plain = compileBoss({ entity: "StudioCreature", model: "creature_x", boss: { ...withArena, arena: null }, plan, speed: 0.2, damage: 4, trackerElsewhere: true, interrupt: "", nbtElsewhere: false, bar: { creature: "creature_x", running: "abilityIndex", step: "-1" }, arena: { abilities: [], running: "false" } })
  expect(plain.methods).toContain("lit, phase, bossBarBroke, 0, 0);")
  expect(`${plain.fields}${plain.methods}`).not.toContain("StudioArena")
  expect(plain.methods).toContain("private void bossReset(boolean far) {\n        setTarget(null);")
})

/** The arena sample (`script/target-arena-sample.ts`) as a build writes it for a target. */
async function arenaSample(target: TargetId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-arena-"))
  roots.push(root)
  const project = await createTargetArenaSample(path.join(root, "涿鹿之野"), target)
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(path.join(root, "涿鹿之野"), source, TEMPLATE)
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
  return { project, source, built, names, read: (name: string) => readFile(path.join(source, name), "utf8") }
}

const PKG = "src/main/java/com/minemods/content_zhuolu_field"
const CLS = "com/minemods/content_zhuolu_field"

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: the arena sample is built with its classes, entries and mixins, its boss's eyes glow through the fog, and the whole tree compiles`, async () => {
    const { built, names, read, source } = await arenaSample(target)
    expect(built.arenaFiles).toEqual([`${CLS}/entity/StudioArena.class`, `${CLS}/entity/StudioFixture.class`, `${CLS}/entity/StudioFixtures.class`, `${CLS}/client/StudioArenaClient.class`, `${CLS}/mixin/StudioArenaFogMixin.class`, `${CLS}/mixin/StudioArenaHurtMixin.class`])
    const mixins = JSON.parse(await read("src/main/resources/zhuolu_field.mixins.json"))
    expect(mixins.mixins).toContain(ARENA_RUNTIME.hurt)
    expect(mixins.client).toContain(ARENA_RUNTIME.fog)
    const creature = await read(names.find((name) => /entity\/StudioCreature\w*\.java$/.test(name))!)
    expect(creature).toContain(`private static final StudioArena.Spec ARENA = new StudioArena.Spec(new String[] {"${ARENA_SAMPLE_IDS.compass}", "${ARENA_SAMPLE_IDS.compass}", "${ARENA_SAMPLE_IDS.compass}", "${ARENA_SAMPLE_IDS.compass}"}, new double[] {10.0, 0.0, 0.0, 10.0, -10.0, 0.0, 0.0, -10.0}`)
    expect(creature).toContain("StudioArena.fight(this, bossBar, ARENA, !isDeadOrDying() && bossState() != BOSS_DORMANT, bossHomeX, bossHomeY, bossHomeZ, abilityRunning());")
    expect(creature).toContain("        StudioArena.end(this);\n        setTarget(null);")
    const renderer = await read(names.find((name) => /client\/StudioCreature\w*Renderer\.java$/.test(name))!)
    expect(renderer).toContain("addRenderLayer(new StudioArenaClient.Glow<>(this));")
    if (target !== "fabric-1.21.1") {
      expect(await read(`${PKG}/StudioContent.java`)).toContain("com.minemods.content_zhuolu_field.entity.StudioFixtures.register();")
      expect(await read(`${PKG}/client/StudioClient.java`)).toContain("com.minemods.content_zhuolu_field.client.StudioArenaClient.register();")
    } else {
      const metadata = JSON.parse(await read("src/main/resources/fabric.mod.json"))
      expect(metadata.entrypoints.main).toEqual(expect.arrayContaining(["com.minemods.content_zhuolu_field.entity.StudioArena", "com.minemods.content_zhuolu_field.entity.StudioFixtures"]))
    }
    const lang = JSON.parse(await read("src/main/resources/assets/zhuolu_field/lang/zh_cn.json"))
    expect(lang["entity.zhuolu_field.studio_fixture"]).toBe("场地物件")
    // One effect glows (the burst), one does not (the comet): only the glowing one has a glow picture, and the shared renderer's glow layer passes over
    // the other. An empty picture beside it crashed every client the moment it was drawn (GeckoLib: "must have at least one pixel").
    const masks = names.filter((name) => name.endsWith("_glowmask.png"))
    expect(masks.filter((name) => name.includes(effectName(ARENA_SAMPLE_IDS.flare)))).toHaveLength(1)
    expect(masks.filter((name) => name.includes(effectName(ARENA_SAMPLE_IDS.spike)))).toHaveLength(0)
    expect(await read(`${PKG}/client/StudioEffectRenderer.java`)).toContain("if (StudioEffects.GLOWS[effect.kind()]) super.render(")
    expect(await read(`${PKG}/entity/StudioEffects.java`)).toMatch(/GLOWS = \{(true, false|false, true)\}/)
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

test("an effect at the locked arena centre reuses that hit even if the ability also throws a projectile", () => {
  const onHit = { type: "effect", at: 4, effect: ARENA_SAMPLE_IDS.spike, where: "hit", hit: 1, forward: 0, up: 0, left: 0, count: 1, layout: "ring", spread: 0 }
  expect(AbilitySchema.safeParse({ ...zhuoluAbility, events: [...zhuoluAbility.events, onHit] }).success).toBe(true)
  // A fixed arena hit also supplies its centre on its own.
  const alone = AbilitySchema.safeParse({ ...zhuoluAbility, hits: [zhuoluAbility.hits[1]], events: [{ ...onHit, hit: 0 }] })
  expect(alone.success).toBe(true)
})

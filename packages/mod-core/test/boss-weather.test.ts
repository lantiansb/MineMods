import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { BOSS_WEATHER_INSTRUCTIONS, LIGHTNING_INSTRUCTIONS, bossWeatherPlan, isLightningHit, lightningShape, struckAbility } from "../src/boss-weather"
import { ABILITY_INSTRUCTIONS, abilityHitShapes, abilityIssues, abilityWords, hitLines, warnPlan } from "../src/creature-abilities"
import { bossModelIssues, bossWords } from "../src/creature-boss"
import { CREATURE_LIFE_INSTRUCTIONS } from "../src/creature-life"
import { AbilitySchema, BossSchema, BossWeatherSchema, type Ability } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { BOSS_WEATHER, compileBossWeather } from "../src/fabric/boss-weather"
import { genTarget } from "../src/platform/target"
import { unportedFeatures } from "../src/platform/ported"
import type { TargetId } from "../src/target/ids"
import { RAIN_WEATHER, STORM_WEATHER, createTargetWeatherSample, stormAbility } from "../script/target-weather-sample"
import { fightingGolemDesign } from "../script/data-gameplay-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * Boss 能力 7 (天气、天色和落雷): the document, the words, the checks and the pictures' shapes of a phase's weather and an ability's lightning, what a build
 * writes for them on every target, that a boss and an ability without them are written as they always were, and that the whole tree compiles on each
 * target's real class path. The real servers are `script/target-weather-check.ts`.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const LOADER_API = /^import net\.(minecraftforge|neoforged|fabricmc)\./m
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const boss = (phases: unknown[]) => BossSchema.parse({ bar: { color: "blue", style: "progress", darken_sky: false }, intro: null, phases, death: { seconds: 2, xp_bursts: 0, explosion: false }, leash: null })
const phase = (below: number, weather?: unknown) => ({ below, clip: null, seconds: 0.5, bar_color: null, speed: 1, damage: 1, ...(weather ? { weather } : {}) })

test("a phase's weather: thunder only with rain, dark from 0 to 1; left out it is the phase before's, the first phase the world's own", () => {
  expect(BossWeatherSchema.safeParse({ rain: true, thunder: true, dark: 0.6 }).success).toBe(true)
  expect(BossWeatherSchema.safeParse({ rain: false, thunder: false, dark: 1 }).success).toBe(true)
  const thunderAlone = BossWeatherSchema.safeParse({ rain: false, thunder: true, dark: 0 })
  expect(thunderAlone.success).toBe(false)
  expect(thunderAlone.error?.issues[0]?.message).toContain("打雷（thunder）要和下雨（rain）一起写")
  expect(BossWeatherSchema.safeParse({ rain: true, thunder: false, dark: 1.2 }).success).toBe(false)
  expect(bossWeatherPlan(boss([phase(0.66, STORM_WEATHER), phase(0.33)]))).toEqual([null, STORM_WEATHER, STORM_WEATHER])
  expect(bossWeatherPlan(boss([phase(0.66), phase(0.33, RAIN_WEATHER)]))).toEqual([null, null, RAIN_WEATHER])
  expect(bossWeatherPlan(boss([]))).toEqual([null])
})

test("a lightning event: no earlier than the wind-up, its warning no earlier than the ability; it lands as an area hit after the ability's own, the very same ability without one", () => {
  const early = AbilitySchema.safeParse({ ...stormAbility, events: [{ type: "lightning", at: 0.5, place: "target", damage: 2, radius: 1 }] })
  expect(early.success).toBe(false)
  expect(early.error?.issues.map((issue) => issue.message).join()).toContain("落雷（lightning）会伤人")
  const warned = AbilitySchema.safeParse({ ...stormAbility, events: [{ type: "lightning", at: 1, place: "target", warn: { seconds: 1.5, look: "pillar", color: "red" }, damage: 2, radius: 1 }] })
  expect(warned.error?.issues.map((issue) => issue.message).join()).toContain("这道雷在第 1 秒")
  expect(AbilitySchema.safeParse({ ...stormAbility, events: [{ type: "lightning", at: 1, place: "target", damage: 2, radius: 7 }] }).success).toBe(false)

  const plain = AbilitySchema.parse({ ...stormAbility, events: stormAbility.events.filter((event) => event.type !== "lightning") })
  expect(struckAbility(plain)).toBe(plain as never)
  const struck = struckAbility(stormAbility)
  expect(struck.hits).toHaveLength(4)
  expect(struck.hits[0]).toBe(stormAbility.hits[0]!)
  expect(struck.events.map((event) => event.type)).toEqual(["sound"])
  expect(struck.hits.slice(1).map((hit) => (isLightningHit(hit) ? hit.lightning : -1))).toEqual([0, 1, 2])
  // Its column, everybody but its own kind, no push, its warning; its own feet as one place decided once.
  expect(struck.hits[1]).toMatchObject({ type: "area", at: 1.2, shape: lightningShape(2), hits: "everyone", damage: 6, knockback: 0, place: "target", warn: { seconds: 0.8, look: "pillar", color: "yellow" } })
  expect(struck.hits[3]).toMatchObject({ place: { type: "pattern", points: [{ forward: 0, left: 0 }] }, damage: 50 })
  expect(warnPlan(struck as Ability)[1]).toEqual({ index: 1, start: 8, ticks: 16 })
})

test("words, instructions, the pictures' shapes and the checks say the weather and the lightning", () => {
  const words = abilityWords.events(stormAbility)
  expect(words).toContain("第 1.2 秒在目标脚下落一道雷（提前 0.8 秒在落点画出黄色的预警（地上一圈加中间一道光柱）；半径 2 格里除了它自己和同类以外的生物掉 6 点血")
  expect(words).toContain("不点火、不改方块")
  expect(abilityWords.felt(stormAbility)).toBe("掉血")
  expect(bossWords.phase(phase(0.66, STORM_WEATHER) as never, [])).toContain("只有这场战斗里的玩家看到天气变了：下起雷雨，天色压暗 60%")
  expect(bossWords.phase(phase(0.66) as never, [])).not.toContain("天气")
  expect(ABILITY_INSTRUCTIONS).toContain(LIGHTNING_INSTRUCTIONS)
  expect(CREATURE_LIFE_INSTRUCTIONS).toContain(BOSS_WEATHER_INSTRUCTIONS)
  // The pictures draw the lightning as the hit it lands as, said as a lightning, with its warning.
  const shapes = abilityHitShapes(struckAbility(stormAbility) as Ability, fightingGolemDesign as never)!
  expect(shapes.map((shape) => shape.lightning)).toEqual([false, true, true, true])
  expect(shapes[1]!.warn).toMatchObject({ look: "pillar", start: 0.4 })
  expect(shapes[2]!.places).toHaveLength(2)
  const lines = hitLines(stormAbility, shapes[1]!)
  expect(lines[0]).toContain("第 1.2 秒这里落雷：图上红色的柱子是半径 2 格")
  expect(lines.join()).toContain("预警：从第 0.4 秒起")
  // The checks: an unwarned bolt at the target's feet, a storm without a bolt, a sky the bar darkens anyway.
  const unwarned = AbilitySchema.parse({ ...stormAbility, events: [{ type: "lightning", at: 1.2, place: "target", damage: 6, radius: 2 }] })
  expect(abilityIssues({ name: "雷公", behavior: "hostile", abilities: [unwarned] }, null).filter((issue) => issue.rule === "ability_warn").map((issue) => issue.text)).toEqual(["「雷公」的招式「引雷」第 1.2 秒的落雷劈在目标脚下，却没有预警（warn）：玩家看不出要躲到哪里，只能挨劈。"])
  expect(abilityIssues({ name: "雷公", behavior: "hostile", abilities: [stormAbility] }, null).filter((issue) => issue.rule === "ability_warn")).toEqual([])
  const stormy = boss([phase(0.5, STORM_WEATHER)])
  expect(bossModelIssues({ name: "雷公", behavior: "hostile", boss: stormy, abilities: [] }, null).map((issue) => issue.rule)).toEqual(["boss_weather"])
  expect(bossModelIssues({ name: "雷公", behavior: "hostile", boss: stormy, abilities: [stormAbility] } as never, null)).toEqual([])
  expect(bossModelIssues({ name: "雷公", behavior: "hostile", boss: { ...stormy, bar: { ...stormy.bar, darken_sky: true } }, abilities: [stormAbility] } as never, null).map((issue) => issue.text)).toEqual([
    "「雷公」的血条写了 darken_sky，战斗里天色本来就按原版压暗；第 1 阶段的 weather.dark 不会让它比原版压暗更亮，只会更暗。",
  ])
})

/** A creature's class as Fabric writes it, for a boss and for its abilities. */
const entityFiles = (extra: Record<string, unknown>) =>
  compileEntity({ modId: "variant_mod", packageName: "com.minemods.content_variant_mod", id: "creature", name: "雷公", health: 300, speed: 0.25, attack_damage: 3, behavior: "hostile", model: fightingGolemDesign, ...extra })
const entityClass = (files: Record<string, string | Uint8Array>) => String(Object.entries(files).find(([name]) => /entity\/StudioCreature\w*\.java$/.test(name))![1])

test("a boss without a weather and an ability without a lightning are written as they always were; with them, only their lines are added", () => {
  const without = entityClass(entityFiles({ boss: boss([phase(0.66), phase(0.33)]) }))
  const withWeather = entityClass(entityFiles({ boss: boss([phase(0.66, STORM_WEATHER), phase(0.33)]) }))
  expect(without).not.toContain("BOSS_WEATHER")
  const added = withWeather.split("\n").filter((line) => !without.split("\n").includes(line))
  expect(added).toEqual([
    "    // Boss 能力 7: per phase (the first is before any line), the weather the players of its fight see, {rain, thunder, darkness}; null is the world's own (StudioBossWeather).",
    "    private static final float[][] BOSS_WEATHER = {null, {1f, 1f, 0.6f}, {1f, 1f, 0.6f}};",
    "        // Boss 能力 7: the weather of its phase, to the players of its bar alone, while its fight is on; dead, asleep, waking up or reset they get the world's own back.",
    "        StudioBossWeather.fight(this, bossBar.getPlayers(), !isDeadOrDying() && (bossState() == BOSS_FIGHT || bossState() == BOSS_CHANGE) ? BOSS_WEATHER[Math.min(bossPhase(), BOSS_WEATHER.length - 1)] : null);",
  ])
  expect(withWeather.split("\n").length - without.split("\n").length).toBe(4)
  // The lightning: the hits it lands as, at fixed places, and the bolts on the tick each lands.
  const plain = AbilitySchema.parse({ ...stormAbility, events: stormAbility.events.filter((event) => event.type !== "lightning") })
  expect(entityClass(entityFiles({ abilities: [plain] }))).not.toContain("StudioLightning")
  const struck = entityClass(entityFiles({ abilities: [stormAbility] }))
  for (const index of [1, 2, 3]) expect(struck).toContain(`StudioLightning.strike(level(), abilityPlaces[${index}]);`)
  expect(struck).toContain("abilityWarn(1, 2, 2.0f, 180.0f, -1.0f, 4.0f, 0.0f, 0.0f, 1, 2, 16);")
  expect(struck).toContain("abilityPlaces[2] = abilityPlacePattern(new double[] {3.0, 2.0, 3.0, -2.0});")
})

test("the weather's classes: Fabric's packet and ticks are its own and named in fabric.mod.json; a facade target's go through the facade; the mixins are client-only everywhere", async () => {
  const pkg = "src/main/java/com/minemods/content_variant_mod"
  const fabric = compileBossWeather({ modId: "variant_mod", packageName: "com.minemods.content_variant_mod", weather: true, lightning: true })
  expect(Object.keys(fabric.files).sort()).toEqual([`${pkg}/client/${BOSS_WEATHER.client}.java`, `${pkg}/entity/${BOSS_WEATHER.server}.java`, `${pkg}/entity/${BOSS_WEATHER.lightning}.java`, `${pkg}/mixin/${BOSS_WEATHER.dark}.java`, `${pkg}/mixin/${BOSS_WEATHER.sky}.java`])
  const metadata = JSON.parse(fabric.patch["src/main/resources/fabric.mod.json"]!(JSON.stringify({ entrypoints: { main: ["a.Main"], client: [] } })))
  expect(metadata.entrypoints).toEqual({ main: ["a.Main", "com.minemods.content_variant_mod.entity.StudioBossWeather"], client: ["com.minemods.content_variant_mod.client.StudioBossWeatherClient"] })
  expect(JSON.parse(fabric.patch["src/main/resources/variant_mod.mixins.json"]!(JSON.stringify({ mixins: [], client: ["Other"] })))).toMatchObject({ mixins: [], client: ["Other", BOSS_WEATHER.dark, BOSS_WEATHER.sky] })
  expect(fabric.entries).toEqual({ common: [], client: [] })
  const server = fabric.files[`${pkg}/entity/${BOSS_WEATHER.server}.java`]!
  for (const line of ["ServerTickEvents.END_SERVER_TICK.register(StudioBossWeather::tick);", "player.connection.send(new ClientboundGameEventPacket(type, value));", "ClientboundGameEventPacket.START_RAINING", "ClientboundGameEventPacket.THUNDER_LEVEL_CHANGE"]) expect(server).toContain(line)
  // Only the lightning: one plain class, nothing to register.
  const bolts = compileBossWeather({ modId: "variant_mod", packageName: "com.minemods.content_variant_mod", weather: false, lightning: true })
  expect(Object.keys(bolts.files)).toEqual([`${pkg}/entity/${BOSS_WEATHER.lightning}.java`])
  expect(bolts.patch).toEqual({})
  for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
    const facade = compileBossWeather({ modId: "variant_mod", packageName: "com.minemods.content_variant_mod", weather: true, lightning: true }, genTarget(target))
    expect(Object.values(facade.files).some((text) => LOADER_API.test(text))).toBe(false)
    expect(facade.files[`${pkg}/entity/${BOSS_WEATHER.server}.java`]).toContain('StudioPlatform.s2c("studio_sky", Sky.class, Sky::write, Sky::read)')
    expect(facade.files[`${pkg}/client/${BOSS_WEATHER.client}.java`]).toContain("StudioClientPlatform.onS2C(StudioBossWeather.CHANNEL, sky -> told(sky.dark()));")
    expect(Object.keys(facade.patch)).toEqual(["src/main/resources/variant_mod.mixins.json"])
    expect(facade.entries).toEqual({ common: ["com.minemods.content_variant_mod.entity.StudioBossWeather"], client: ["com.minemods.content_variant_mod.client.StudioBossWeatherClient"] })
  }
})

/** The weather sample (`script/target-weather-sample.ts`) as a build writes it for a target. */
async function weatherSample(target: TargetId, lightning: boolean) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-weather-"))
  roots.push(root)
  const project = await createTargetWeatherSample(path.join(root, "雷泽"), target, { lightning })
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(path.join(root, "雷泽"), source, TEMPLATE)
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
  return { project, source, built, names, read: (name: string) => readFile(path.join(source, name), "utf8") }
}

const PKG = "src/main/java/com/minemods/content_thunder_marsh"
const CLS = "com/minemods/content_thunder_marsh"

test("Fabric 1.21.1: a boss with a weather and an ability with lightning are built with their classes, entry points and mixins, and the whole tree compiles", async () => {
  const { built, names, read, source } = await weatherSample("fabric-1.21.1", true)
  expect(built.weatherFiles).toEqual([`${CLS}/entity/StudioBossWeather.class`, `${CLS}/client/StudioBossWeatherClient.class`, `${CLS}/mixin/StudioBossDarkMixin.class`, `${CLS}/mixin/StudioBossSkyMixin.class`, `${CLS}/entity/StudioLightning.class`])
  const metadata = JSON.parse(await read("src/main/resources/fabric.mod.json"))
  expect(metadata.entrypoints.main).toContain("com.minemods.content_thunder_marsh.entity.StudioBossWeather")
  expect(metadata.entrypoints.client).toContain("com.minemods.content_thunder_marsh.client.StudioBossWeatherClient")
  expect(JSON.parse(await read("src/main/resources/thunder_marsh.mixins.json")).client).toEqual(expect.arrayContaining(["StudioBossDarkMixin", "StudioBossSkyMixin"]))
  const lord = await read(names.find((name) => /entity\/StudioCreature\w*\.java$/.test(name))!)
  expect(lord).toContain("private static final float[][] BOSS_WEATHER = {null, {1f, 1f, 0.6f}, {1f, 0f, 0.3f}};")
  expect(lord).toContain("StudioLightning.strike(level(), abilityPlaces[3]);")
  if (!hasTargetJavac(CLASSPATH["fabric-1.21.1"])) return
  const compiled = await targetJavac(CLASSPATH["fabric-1.21.1"], path.join(source, "src", "main", "java"))
  expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
  expect(compiled.code).toBe(0)
}, 180000)

for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: a boss with a weather goes through the facade (its channel, its tick, its client entry, its client mixins) and the whole tree compiles`, async () => {
    const { built, names, read, source } = await weatherSample(target, false)
    expect(built.weatherFiles).toEqual([`${CLS}/entity/StudioBossWeather.class`, `${CLS}/client/StudioBossWeatherClient.class`, `${CLS}/mixin/StudioBossDarkMixin.class`, `${CLS}/mixin/StudioBossSkyMixin.class`])
    expect(await read(`${PKG}/StudioContent.java`)).toContain("com.minemods.content_thunder_marsh.entity.StudioBossWeather.register();")
    expect(await read(`${PKG}/client/StudioClient.java`)).toContain("com.minemods.content_thunder_marsh.client.StudioBossWeatherClient.register();")
    expect(JSON.parse(await read("src/main/resources/thunder_marsh.mixins.json")).client).toEqual(expect.arrayContaining(["StudioBossDarkMixin", "StudioBossSkyMixin"]))
    const java = names.filter((name) => name.endsWith(".java"))
    const loaderNamed = (await Promise.all(java.map(async (name) => (LOADER_API.test(await read(name)) ? [name] : [])))).flat()
    expect(loaderNamed.sort()).toEqual([`${PKG}/ThunderMarshMod.java`, `${PKG}/platform/StudioClientPlatform.java`, `${PKG}/platform/StudioPlatform.java`])
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 180000)

  test(`${target}: the lightning's class names only the game and compiles by itself on the target's class path`, async () => {
    const made = compileBossWeather({ modId: "variant_mod", packageName: "com.minemods.content_variant_mod", weather: false, lightning: true }, genTarget(target))
    expect(Object.keys(made.files)).toEqual([`src/main/java/com/minemods/content_variant_mod/entity/${BOSS_WEATHER.lightning}.java`])
    expect(Object.values(made.files).some((text) => LOADER_API.test(text))).toBe(false)
    if (!hasTargetJavac(CLASSPATH[target])) return
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-lightning-"))
    roots.push(root)
    await Promise.all(Object.entries(made.files).map(async ([file, text]) => {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true })
      await writeFile(path.join(root, file), text)
    }))
    const compiled = await targetJavac(CLASSPATH[target], path.join(root, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 180000)

  // The lightning is an ability event: it is generated for a facade target once the abilities are (A 组); until then a build says so, and this compiles the tree as soon as they are.
  test(`${target}: an ability with lightning, once abilities go through the facade, compiles with its bolts`, async () => {
    const project = { entities: [{ name: "雷公", abilities: [stormAbility] }], blocks: [], items: [], workspace: { assets: [] } }
    if (unportedFeatures(project, genTarget(target)).some((entry) => entry.group === "abilities")) return
    const { built, read, source, names } = await weatherSample(target, true)
    expect(built.weatherFiles).toContain(`${CLS}/entity/StudioLightning.class`)
    expect(await read(names.find((name) => /entity\/StudioCreature\w*\.java$/.test(name))!)).toContain("StudioLightning.strike(level(), abilityPlaces[1]);")
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 180000)
}

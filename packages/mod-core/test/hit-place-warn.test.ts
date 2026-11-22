import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { TICKS, WARN_COLOR_IDS, WARN_LIMITS } from "../src/ability-words"
import { assembleBuildSource } from "../src/build-source"
import { ABILITY_INSTRUCTIONS, abilityHitShapes, abilityIssues, abilityWords, aroundOffsets, hitLines, hitPlaces, placeRandom, placeSeed, placeTarget, shapeFaces, warnPlan } from "../src/creature-abilities"
import { readGeneratedCreature } from "../src/creature-contract"
import { AbilitySchema, BossSchema, EntitySchema, type Ability } from "../src/entity-runtime"
import { ABILITY_WARN, compileAbilityWarn } from "../src/fabric/ability-warn"
import { compileEntity } from "../src/fabric/entity"
import { saveProject } from "../src/project"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { dragonAnchoredAbilities, dragonBoss, dragonDesign, dragonFlight, dragonHabits, dragonHitbox } from "./giant-flier"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac, targetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

/**
 * Boss 能力 3: an area hit put down somewhere other than round the creature (`place`), and the warning drawn where it will land before it does (`warn`).
 * The server decides every place; the pictures and the warning use the same shape numbers as the hit.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-warn-"))
  roots.push(root)
  return root
}

const sha = (files: Record<string, string | Uint8Array>) => {
  const text = Object.keys(files).sort().map((name) => `${name}\n${files[name]}`).join("\n")
  return `${createHash("sha256").update(text).digest("hex").slice(0, 16)} ${text.length}`
}
const entityPath = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const java = (files: Record<string, string | Uint8Array>) => String(files[entityPath])

const [slam, burst] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability, Ability]
const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }

// A stomp at the feet of the one it fights, warned of by a red ring 0.8 s before; a rain of five falls round them, each warned of by an orange pillar;
// a cross of four boxes round itself decided at the hit; and its own frontal sweep, warned of where it stands when the warning starts.
const quake = AbilitySchema.parse({
  ...slam,
  id: "quake",
  name: "地裂",
  start: { ...slam.start, min_distance: 4, max_distance: 12 },
  hits: [{ type: "area", at: 1, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 2.5 }, hits: "everyone", damage: 6, knockback: 0.6, effects: [{ effect: "slowness", duration_ticks: 40, amplifier: 0 }], place: "target", warn: { seconds: 0.8, look: "ring", color: "red" } }],
  events: [],
})
test("a landing warning can cover the windup when the leap reserves its target at cast start", () => {
  const leap = {type:"leap",at:0.5,land:1,height:2,aim:"target",max_distance:12,landing_hit:0}
  const parse = (move:unknown) => AbilitySchema.safeParse({...quake,moves:[move]})
  expect(parse(leap).error?.issues.map(i=>i.message).join(" ")).toContain("第 0.5 秒")
  expect(parse({...leap,lock_at:"cast_start"}).success).toBe(true)
  expect(parse({...leap,landing_hit:9}).success).toBe(false)
})
test("稳重跳扑在蓄力定点，预警和落地事件沿用同一个中心", () => {
  const ability = AbilitySchema.parse({
    ...quake,
    moves: [{ type: "leap", at: 0.5, land: 1, height: 2, aim: "target", max_distance: 12, lock_at: "cast_start", landing_hit: 0 }],
    events: [{ type: "sound", at: 1, where: "hit", hit: 0, sound: "entity.iron_golem.attack", volume: 1, pitch: 1 }],
  })
  const files = compileEntity({ ...plain, steady: { preset: "huge" }, abilities: [ability] })
  const entity = String(Object.entries(files).find(([path]) => path.endsWith("/StudioCreature.java"))![1])
  const step = entity.slice(entity.indexOf("private void abilityStep0("))
  expect(step).toMatch(/if \(tick == 0\) \{\s+abilityLeapStart\(20,[^;]+true, false\);/)
  expect(step).toMatch(/if \(tick == 4\) \{\s+abilityPlaces\[0\] = new double\[\] \{abilityLeapToX, abilityLeapToY, abilityLeapToZ\};/)
  expect(step).toMatch(/if \(tick == 10\) \{\s+abilityLeapStart\(10,[^;]+false, true\);/)
  expect(step).toContain("abilityEventPlace(0, landingOffset,")
  expect(entity).toContain("if (stored && flat > 1.0e-4) abilityTurnToward(")
})

const rain = AbilitySchema.parse({
  ...burst,
  id: "rain",
  name: "落石",
  start: { ...burst.start, min_distance: 3, max_distance: 16 },
  hits: [
    { type: "area", at: 1.1, shape: { type: "arc", reach: 1.5, angle: 360, low: -0.5, high: 3 }, hits: "everyone", damage: 5, knockback: 0, effects: [], place: { type: "around_target", count: 5, spread: 6 }, warn: { seconds: 1, look: "pillar", color: "orange" } },
    { type: "area", at: 1.4, shape: { type: "box", forward: 0, up: 0.5, left: 0, width: 2, height: 2, depth: 2 }, hits: "target", damage: 4, knockback: 0.4, effects: [], place: { type: "pattern", points: [{ forward: 3, left: 0 }, { forward: -3, left: 0 }, { forward: 0, left: 3 }, { forward: 0, left: -3 }] } },
  ],
  events: [],
})
const sweep = AbilitySchema.parse({ ...slam, id: "sweep", name: "横扫", hits: [{ ...slam.hits[0]!, warn: { seconds: 0.5, look: "ring", color: "yellow" } }] })

const refused = (change: Record<string, unknown>, ability: Ability = quake) =>
  AbilitySchema.safeParse({ ...ability, hits: [{ ...ability.hits[0]!, ...change }] }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
/** Hit number `index` of an ability, known to be an area hit. */
const area = (ability: Ability, index: number) => ability.hits[index] as Extract<Ability["hits"][number], { type: "area" }>

test("old definitions generate the same Java to the byte; an explicit place of self is the same as none", () => {
  // Hashes taken at 16b48ee, before place and warn existed (the same fixtures as boss-runtime, air-station and giant-anchors use).
  const boss = BossSchema.parse({
    bar: { color: "purple", style: "notched_10", darken_sky: true },
    intro: { wake_distance: 16, clip: "roar", seconds: 0.8, sound: "entity.iron_golem.attack" },
    phases: [{ below: 0.5, clip: "wave", seconds: 1, bar_color: "red", speed: 1.15, damage: 1.3, abilities: ["pull"] }],
    death: { seconds: 4, xp_bursts: 6, explosion: true },
    leash: { distance: 48, reset_seconds: 30 },
  })
  const shake = { type: "shake" as const, at: 0.7, strength: 2, radius: 16, seconds: 1 }
  const debris = { type: "debris" as const, at: 0.7, where: "hit" as const, hit: 0, forward: 1.2, up: 0, left: 0, radius: 3, count: 10 }
  const pull = { ...slam, id: "pull", hits: [{ ...slam.hits[0]!, knockback: -0.8 }], events: [...slam.events, shake, debris] } as Ability
  const dragon = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "dragon", name: "巨龙", health: 400, speed: 0.25, attack_damage: 3, behavior: "hostile" as const }
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(compileEntity({ ...plain, abilities: [slam, burst] }))).toBe("a013bae9c3c77759 60069")
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(compileEntity({ ...plain, abilities: [pull, burst], boss }))).toBe("b0b663b51e02405b 77844")
  // names only (Yarn → Mojang), checked 2026-11-14
  // re-pinned 2026-11-14 (任务二 超大体型): the dragon's parts name bones, which they now follow (a table and its lookup, hitbox-follow.ts); the same document with its parts' bones taken out is the old hash to the byte (test/hitbox-follow.test.ts)
  expect(sha(compileEntity({ ...dragon, model: dragonDesign, hitbox: dragonHitbox, abilities: dragonAnchoredAbilities, flight: dragonFlight, habits: dragonHabits, boss: dragonBoss } as never))).toBe("122d8c28997f0d9e 298450")
  const selfish = AbilitySchema.parse({ ...slam, hits: [{ ...slam.hits[0]!, place: "self" }] })
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(compileEntity({ ...plain, abilities: [selfish, burst] }))).toBe("a013bae9c3c77759 60069")
  // The words of an old hit are what they were.
  expect(abilityWords.hit(slam.hits[0]!)).toBe(abilityWords.hit(selfish.hits[0]!))
  expect(abilityWords.hit(slam.hits[0]!)).not.toContain("预警")
})

test("place and warn are bounded and say what is wrong in plain words", () => {
  expect(refused({})).toBe("")
  expect(AbilitySchema.safeParse(rain).success).toBe(true)
  expect(AbilitySchema.safeParse(sweep).success).toBe(true)
  // Only a ball, a box and a full circle may be put down elsewhere; a beam and a cone are never warned of.
  expect(refused({ shape: { type: "line", up: 1, length: 6, radius: 0.5 }, warn: undefined })).toContain("只有球（sphere）、盒子（box）和一整圈的弧")
  expect(refused({ shape: { type: "arc", reach: 3, angle: 120, low: 0, high: 2 } })).toContain("一整圈的弧")
  expect(refused({ shape: { type: "arc", reach: 3, angle: 360, low: 0, high: 2 } })).toBe("")
  expect(refused({ place: "self", shape: { type: "cone", up: 1, length: 6, angle: 40 } })).toContain("不能写预警")
  expect(refused({ place: "self", shape: { type: "arc", reach: 3, angle: 120, low: 0, high: 2 } })).toBe("")
  // Elsewhere: no bone, no pull toward itself.
  expect(refused({ bone: "head" })).toContain("不能再写 bone")
  expect(refused({ place: "self", bone: "head" })).toContain("不能写 bone")
  expect(refused({ knockback: -0.5 })).toContain("不能写负的 knockback")
  expect(refused({ place: "self", knockback: -0.5 })).toBe("")
  // The warning starts no earlier than the ability: at 1 s, a warning of 1 s is the most.
  expect(refused({ warn: { seconds: 1, look: "ring", color: "red" } })).toBe("")
  expect(refused({ warn: { seconds: 1.05, look: "ring", color: "red" } })).toContain("预警最早在招式开始的那一刻出现")
  expect(refused({ warn: { seconds: 0.1, look: "ring", color: "red" } })).not.toBe("")
  expect(refused({ warn: { seconds: 3.5, look: "ring", color: "red" } })).not.toBe("")
  expect(refused({ warn: { seconds: 0.8, look: "glow", color: "red" } })).not.toBe("")
  expect(refused({ warn: { seconds: 0.8, look: "ring", color: "pink" } })).not.toBe("")
  expect(WARN_COLOR_IDS).toEqual(["red", "orange", "yellow", "purple", "blue", "white"])
  expect(refused({ place: { type: "around_target", count: 17, spread: 4 } })).not.toBe("")
  expect(refused({ place: { type: "around_target", count: 4, spread: 0.5 } })).not.toBe("")
  expect(refused({ place: { type: "around_target", count: 4, spread: 13 } })).not.toBe("")
  expect(refused({ place: { type: "pattern", points: [] } })).not.toBe("")
  expect(refused({ place: { type: "pattern", points: Array.from({ length: 17 }, () => ({ forward: 1, left: 0 })) } })).not.toBe("")
  expect(refused({ place: "elsewhere" })).not.toBe("")
  // Debris can reuse the point already locked by the warning.
  const marked = AbilitySchema.safeParse({ ...quake, events: [{ type: "debris", at: 1, where: "hit", hit: 0, forward: 0, up: 0, left: 0, radius: 2, count: 4 }] })
  expect(marked.success).toBe(true)
  // A creature's document carries them as written.
  const old = { id: "11111111-1111-4111-8111-111111111111", name: "地裂者", description: "", health: 80, speed: 0.25, attack_damage: 3, behavior: "hostile", model_asset_id: null }
  expect(EntitySchema.parse({ ...old, abilities: [quake, rain] }).abilities?.[1]?.hits[0]).toMatchObject({ place: { type: "around_target", count: 5, spread: 6 }, warn: { seconds: 1, look: "pillar", color: "orange" } })
})

test("the warning begins on its own tick and the places are laid out by one rule the server and the pictures share", () => {
  expect(warnPlan(quake)).toEqual([{ index: 0, start: 4, ticks: 16 }])
  expect(warnPlan(rain)).toEqual([{ index: 0, start: 2, ticks: 20 }, null])
  expect(warnPlan(slam)).toEqual([null])
  // A warning as long as the hit is late starts on the first tick.
  expect(warnPlan(AbilitySchema.parse({ ...quake, hits: [{ ...quake.hits[0]!, warn: { seconds: 1, look: "ring", color: "red" } }] }))).toEqual([{ index: 0, start: 0, ticks: 20 }])
  // The numbers are mulberry32's: the same seed, the same numbers; every one from 0 up to 1.
  const first = placeRandom(7)
  const again = placeRandom(7)
  const drawn = Array.from({ length: 200 }, () => first())
  expect(Array.from({ length: 200 }, () => again())).toEqual(drawn)
  expect(drawn.every((value) => value >= 0 && value < 1)).toBe(true)
  expect(placeRandom(1)()).toBeCloseTo(0.6270739405881613, 12)
  // Two hits of a cast are scattered apart; every place lies within the spread.
  expect(placeSeed(5, 0)).not.toBe(placeSeed(5, 1))
  const around = aroundOffsets(16, 6, placeSeed(WARN_LIMITS.seed, 0))
  expect(around).toHaveLength(16)
  expect(around.every((offset) => Math.hypot(offset.forward, offset.left) <= 6 + 1e-9)).toBe(true)
  // The places in the creature's own terms: its feet, the target's feet straight ahead, round them, or the pattern as written.
  const target = placeTarget(quake)
  expect(target).toBe(8)
  expect(hitPlaces(slam.hits[0]!, 0, target)).toEqual([{ forward: 0, up: 0, left: 0 }])
  expect(hitPlaces(quake.hits[0]!, 0, target)).toEqual([{ forward: 8, up: 0, left: 0 }])
  expect(hitPlaces(rain.hits[1]!, 1, target)).toEqual([{ forward: 3, up: 0, left: 0 }, { forward: -3, up: 0, left: 0 }, { forward: 0, up: 0, left: 3 }, { forward: 0, up: 0, left: -3 }])
  const scattered = hitPlaces(rain.hits[0]!, 0, placeTarget(rain))
  expect(scattered).toHaveLength(5)
  expect(scattered.every((place) => Math.hypot(place.forward - placeTarget(rain), place.left) <= 6 + 1e-3)).toBe(true)
})

test("the pictures draw the hit's own shape at every place, with the one it fights where they take them to stand, and say the warning and its delay", () => {
  const [stomp] = abilityHitShapes(quake, fightingGolemDesign as never)!
  const ball = shapeFaces(area(quake, 0).shape)
  // The same faces as the hit's shape, moved to the target's feet 8 blocks ahead (model pixels: 16 to the block, ahead is -Z).
  expect(stomp!.faces).toHaveLength(ball.length)
  expect(stomp!.faces[0]![0]).toEqual([ball[0]![0]![0], ball[0]![0]![1], ball[0]![0]![2] - 8 * 16])
  expect(stomp!.dummy).not.toBeNull()
  expect(stomp!.remote).toBe(true)
  expect(stomp!.warn).toEqual({ seconds: 0.8, look: "ring", color: "red", start: 0.2 })
  // A swing is not measured toward something that lands away from the creature.
  expect(stomp!.arrives).toBeNull()
  expect(stomp!.gap).toBeNull()
  const lines = hitLines(quake, stomp!)
  expect(lines.join("")).toContain("打在目标脚下")
  expect(lines.join("")).toContain("预警：从第 0.2 秒起（比判定早 0.8 秒）")
  expect(lines.join("")).toContain("红色")
  expect(lines.join("")).not.toContain("动得最靠前的部件")
  const [falls, cross] = abilityHitShapes(rain, fightingGolemDesign as never)!
  expect(falls!.faces).toHaveLength(5 * shapeFaces(area(rain, 0).shape).length)
  expect(falls!.places).toHaveLength(5)
  expect(cross!.faces).toHaveLength(4 * shapeFaces(area(rain, 1).shape).length)
  expect(cross!.dummy).toBeNull()
  expect(hitLines(rain, falls!).join("")).toContain("5 个落点上各画出橙色的地上一圈加中间一道光柱")
  // A warned sweep round itself is drawn where it always was, and is still measured against its swing.
  const [swept] = abilityHitShapes(sweep, fightingGolemDesign as never)!
  const [plainSwept] = abilityHitShapes(slam, fightingGolemDesign as never)!
  expect(swept!.faces).toEqual(plainSwept!.faces)
  expect(swept!.arrives).toBe(plainSwept!.arrives)
  expect(hitLines(sweep, swept!).join("")).toContain("落点和朝向在预警开始那一刻定在它当时站的地方")
  // The card's words.
  expect(abilityWords.hit(quake.hits[0]!)).toContain("在目标脚下打半径 2.5 格的一团里的所有生物（提前 0.8 秒在落点画出红色的预警")
  expect(abilityWords.hit(rain.hits[0]!)).toContain("随机的 5 个地方")
})

test("the reviewer is told when a warning is too short to act on, too short to walk out of, or missing", () => {
  const creature = { name: "地裂者", behavior: "hostile", abilities: [quake, rain] }
  const found = (abilities: Ability[]) => abilityIssues({ ...creature, abilities }, fightingGolemDesign.animations).filter((issue) => issue.rule === "ability_warn")
  expect(found([quake, rain])).toEqual([])
  const quick = AbilitySchema.parse({ ...quake, hits: [{ ...quake.hits[0]!, warn: { seconds: 0.3, look: "ring", color: "red" } }] })
  expect(found([quick])).toMatchObject([{ stops: false, text: expect.stringContaining("预警只提前 0.3 秒（不到 0.4 秒）") }])
  const wide = AbilitySchema.parse({ ...quake, hits: [{ ...quake.hits[0]!, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 4 }, warn: { seconds: 0.5, look: "ring", color: "red" } }] })
  expect(found([wide])).toMatchObject([{ stops: false, text: expect.stringContaining("要走 4.3 格才出得了判定范围") }])
  const silent = AbilitySchema.parse({ ...quake, hits: [{ ...quake.hits[0]!, warn: undefined }] })
  expect(found([silent])).toMatchObject([{ stops: false, text: expect.stringContaining("却没有预警") }])
  // A hit at the target's feet reaches wherever they are: never said to fall short of where it starts.
  expect(abilityIssues(creature, fightingGolemDesign.animations).filter((issue) => issue.rule === "ability_reach")).toEqual([])
})

test("the external AI is told how to write a place and a warning, and what each limit is", () => {
  expect(ABILITY_INSTRUCTIONS).toContain('{type:"around_target", count, spread}')
  expect(ABILITY_INSTRUCTIONS).toContain('{type:"pattern", points:[{forward, left}]}')
  expect(ABILITY_INSTRUCTIONS).toContain("warn 是出手前的预警：{seconds, look, color}")
  expect(ABILITY_INSTRUCTIONS).toContain("at 减 seconds 不能小于 0")
  expect(ABILITY_INSTRUCTIONS).toContain("red（红色）")
  expect(ABILITY_INSTRUCTIONS).toContain("line 和 cone 不能写 warn")
})

test("the generated creature decides the places on the server, warns of them, and hits exactly there", () => {
  const source = java(compileEntity({ ...plain, abilities: [quake, rain, sweep] }))
  // quake: warned on tick 4, hit on tick 20, at the target's feet.
  const step0 = /private void abilityStep0\(int tick\) \{\n([\s\S]*?)\n    \}\n/.exec(source)![1]!
  expect(step0).toContain("if (tick == 4) {\n            abilityPlaces[0] = abilityPlaceTarget();\n            abilityPlaceYaw[0] = abilityYaw;\n            abilityWarn(0, 0, 0.0f, 0.0f, 0.0f, 2.5f, 0.0f, 0.0f, 0, 0, 16);")
  expect(step0).toContain("if (tick == 20) {\n            abilityWarnsOut = Math.max(0, abilityWarnsOut - 1);\n            for (LivingEntity victim : abilityVictims(true, 3.5, abilityPlaces[0])) {")
  expect(step0).toContain("int place = abilityInSphereAt(victim, 0, 0.0, 0.0, 0.0, 2.5);")
  expect(step0).toContain("victim.addEffect(new MobEffectInstance(MobEffects.MOVEMENT_SLOWDOWN, 40, 0), this);")
  // rain: five places scattered by the cast's own number, an orange pillar; then four boxes decided at their hit.
  const step1 = /private void abilityStep1\(int tick\) \{\n([\s\S]*?)\n    \}\n/.exec(source)![1]!
  expect(step1).toContain("abilityPlaces[0] = abilityPlaceAround(5, 6.0, 0);")
  expect(step1).toContain(`abilityWarn(0, 2, 1.5f, 180.0f, -0.5f, 3.0f, 0.0f, 0.0f, ${ABILITY_WARN.looks.pillar}, ${ABILITY_WARN.colors.orange}, 20);`)
  expect(step1).toContain("abilityPlaces[1] = abilityPlacePattern(new double[] {3.0, 0.0, -3.0, 0.0, 0.0, 3.0, 0.0, -3.0});")
  expect(step1).toContain("abilityVictims(false, ")
  expect(source).toContain("abilitySeed = getRandom().nextInt();")
  expect(source).toContain("abilityRoll = abilitySeed ^ ((slot + 1) * 0x9E3779B9);")
  // sweep: its own feet and facing, fixed when its warning starts.
  expect(source).toContain("abilityPlaces[0] = abilityPlaceSelf();")
  expect(source).toContain("int place = abilityInArcAt(victim, 0, 2.5, 60.0, -0.5, 2.5);")
  // Cut short, the warnings are taken back; a push goes away from the place that held them, never at the creature itself.
  expect(source).toMatch(/private void stopAbility\(\) \{[\s\S]*?abilityWarnTakeBack\(\);\n    \}/)
  expect(source).toContain(`StudioWarn.clear(world, getId(), every);`)
  expect(source).toContain("other -> other != this && other.isAlive() && other.getType() != getType()")
  // The hits are read back from the class on the ticks the plan says.
  const read = readGeneratedCreature(source, null)
  expect(read.abilities?.map((ability) => ability.hits)).toEqual([[20], [22, 28], [14]])
})

test("the warning's runtime is a packet the server sends and a player's game draws, registered as entry points", () => {
  const made = compileAbilityWarn({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod" })
  const server = String(made.files["src/main/java/com/minemods/content_golem_mod/entity/StudioWarn.java"])
  const client = String(made.files["src/main/java/com/minemods/content_golem_mod/client/StudioWarnClient.java"])
  expect(server).toContain('ResourceLocation.fromNamespaceAndPath("golem_mod", "studio_warn")')
  expect(server).toContain("PayloadTypeRegistry.playS2C().register(Warn.ID, Warn.CODEC);")
  expect(server).toContain(`<= ${WARN_LIMITS.range * WARN_LIMITS.range}.0`)
  // Taking warnings back names only the creature: however many places its warnings had, the packet carries none (a packet is never read for more than a hit may have).
  expect(server).toContain("new Warn(owner, 0, 0, 0, 0, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, new double[0]), places);")
  expect(server).toContain('if (count < 0 || count > 16) throw new IllegalArgumentException(')
  expect(client).toContain("ClientTickEvents.END_CLIENT_TICK.register(StudioWarnClient::draw);")
  // Drawn as the game draws a forced, always visible particle (straight to the particle engine), keeping each grain so a warning taken back takes its dust with it at once.
  expect(client).toContain("Particle grain = Minecraft.getInstance().particleEngine.createParticle(effect, x, y, z, 0.0, 0.0, 0.0);")
  expect(client).toContain("if (grain != null) drawn.add(grain);")
  expect(client).toContain("for (Particle grain : running.drawn()) grain.remove();")
  expect(client).toContain("drawn.removeIf(grain -> !grain.isAlive());")
  expect(client).not.toContain("addAlwaysVisibleParticle")
  // The client decides nothing: it has no random numbers and reads every place from the packet.
  expect(client).not.toMatch(/Random|getTarget|getEntitiesOfClass/)
  expect(made.classes).toEqual(["com/minemods/content_golem_mod/entity/StudioWarn.class", "com/minemods/content_golem_mod/client/StudioWarnClient.class"])
  const metadata = JSON.parse(made.patch["src/main/resources/fabric.mod.json"]!(JSON.stringify({ entrypoints: { main: ["a.Main"], client: ["a.Client"] } })))
  expect(metadata.entrypoints).toEqual({ main: ["a.Main", "com.minemods.content_golem_mod.entity.StudioWarn"], client: ["a.Client", "com.minemods.content_golem_mod.client.StudioWarnClient"] })
})

async function warnProject(abilities: Ability[] | null) {
  const root = await temporary()
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const golem = sample.entities[0]!
  const project = abilities ? await saveProject(directory, { ...sample, entities: [{ ...golem, abilities: EntitySchema.shape.abilities.unwrap().unwrap().parse(abilities) }] }, sample.revision) : sample
  const source = path.join(root, "source")
  await mkdir(source)
  return { root, project, source, built: await assembleBuildSource(directory, source, TEMPLATE) }
}

test("a project with a warned hit builds the warning's runtime and its entry points; one without builds none of it", async () => {
  const made = await warnProject([quake, rain])
  const base = path.join(made.source, "src/main/java/com/minemods/content_azure_sample")
  expect(await readFile(path.join(base, `entity/${ABILITY_WARN.server}.java`), "utf8")).toContain("record Warn")
  const metadata = JSON.parse(await readFile(path.join(made.source, "src/main/resources/fabric.mod.json"), "utf8"))
  expect(metadata.entrypoints.main).toContain("com.minemods.content_azure_sample.entity.StudioWarn")
  expect(metadata.entrypoints.client).toContain("com.minemods.content_azure_sample.client.StudioWarnClient")
  expect(made.built.warnFiles).toHaveLength(2)
  const plainBuilt = await warnProject(null)
  expect(plainBuilt.built.warnFiles).toEqual([])
  expect(JSON.parse(await readFile(path.join(plainBuilt.source, "src/main/resources/fabric.mod.json"), "utf8")).entrypoints.main.join()).not.toContain("StudioWarn")
})

test.skipIf(!hasTargetJavac(OFFICIAL))("a creature with placed and warned hits, and the warning's runtime, compile against Minecraft 1.21.1 (Mojang's names), GeckoLib and Fabric API", async () => {
  const root = await temporary()
  const boss = BossSchema.parse({ bar: { color: "red", style: "progress", darken_sky: false }, intro: null, phases: [{ below: 0.5, clip: null, seconds: 1, bar_color: null, speed: 1, damage: 1.5, abilities: ["rain"] }], death: { seconds: 2, xp_bursts: 0, explosion: false }, leash: null })
  const pull = AbilitySchema.parse({ ...sweep, id: "pull", hits: [{ ...sweep.hits[0]!, knockback: -0.6 }] })
  const shapes = [
    { classSuffix: "", abilities: [quake, rain, sweep] },
    { classSuffix: "B", abilities: [quake, rain, pull], boss },
    // A combo whose steps hit at the target's feet: its damage scale reaches those hits too.
    { classSuffix: "C", abilities: [quake, rain, sweep], combos: [{ id: "storm", name: "连击", steps: ["quake", "sweep"], gap_ticks: 2, damage_scale: 1.2, start: quake.start }] },
  ]
  await Promise.all(
    shapes.map(async (shape) => {
      const files = compileEntity({ ...plain, ...shape } as never)
      await writeFile(path.join(root, `StudioCreature${shape.classSuffix}.java`), String(files[`src/main/java/com/minemods/content_golem_mod/entity/StudioCreature${shape.classSuffix}.java`]))
    }),
  )
  const support = compileAbilityWarn({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod" })
  await Promise.all(Object.entries(support.files).map(async ([name, text]) => writeFile(path.join(root, path.basename(name)), text)))
  const strikeAt = (text: string) => /private boolean abilityStrikeAt\([^)]*\) \{\n([^\n]*)/.exec(text)![1]!
  expect(strikeAt(await readFile(path.join(root, "StudioCreatureC.java"), "utf8"))).toContain("damage * abilityDamageScale()")
  expect(strikeAt(await readFile(path.join(root, "StudioCreature.java"), "utf8"))).not.toContain("abilityDamageScale")
  const compiled = await targetJavac(OFFICIAL, root)
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 180000)

test.skipIf(!hasTargetJavac(OFFICIAL))("the whole generated tree of a project with warned hits compiles", async () => {
  const made = await warnProject([quake, rain, sweep])
  const compiled = (await compileTreeFor(OFFICIAL, made.source))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 180000)

test.skipIf(!hasTargetJavac(OFFICIAL))("the server's numbers are the pictures': the generated drawing gives the same places as placeRandom for the same seed", async () => {
  const root = await temporary()
  const source = java(compileEntity({ ...plain, abilities: [rain] }))
  const random = /private double abilityRandom\(\) \{[\s\S]*?\n    \}/.exec(source)![0]
  await writeFile(
    path.join(root, "Draw.java"),
    `public final class Draw {
    private int abilityRoll;
    ${random.trim()}
    public static void main(String[] args) {
        Draw draw = new Draw();
        int seed = Integer.parseInt(args[0]);
        int slot = Integer.parseInt(args[1]);
        draw.abilityRoll = seed ^ ((slot + 1) * 0x9E3779B9);
        StringBuilder out = new StringBuilder();
        for (int index = 0; index < 8; index++) out.append(draw.abilityRandom()).append('\\n');
        System.out.print(out);
    }
}
`,
  )
  const compiled = await targetJavac(OFFICIAL, root)
  expect(compiled.code).toBe(0)
  const classes = path.join(root, "classes")
  await mkdir(classes)
  const tool = (name: string) => path.join(process.env.MINEMODS_JDK21!, "bin", process.platform === "win32" ? `${name}.exe` : name)
  const built = Bun.spawnSync([tool("javac"), "-d", classes, path.join(root, "Draw.java")])
  expect(built.exitCode).toBe(0)
  const run = Bun.spawnSync([tool("java"), "-cp", classes, "Draw", String(WARN_LIMITS.seed), "0"])
  const fromJava = run.stdout.toString().trim().split(/\r?\n/).map(Number)
  const roll = placeRandom(placeSeed(WARN_LIMITS.seed, 0))
  expect(fromJava).toEqual(Array.from({ length: 8 }, () => roll()))
}, 60000)

test("a warning lasts as many ticks as it says, in the creature's own ticks", () => {
  expect(warnPlan(quake)[0]!.ticks / TICKS).toBe(0.8)
})

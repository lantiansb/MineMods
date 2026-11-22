import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { addEntryCalls, assembleBuildSource } from "../src/build-source"
import { ABILITY_INSTRUCTIONS, abilityWords, boneIssues } from "../src/creature-abilities"
import { AbilitySchema, type Ability } from "../src/entity-runtime"
import { expandFeedback } from "../src/hit-feedback"
import { FlashEventSchema, GROUND_FX_INSTRUCTIONS, GROUND_FX_LIMITS, abilitiesGroundFx, allGroundFx, groundFxParticleAssets, groundFxWords } from "../src/ground-fx"
import { groundFxPictures } from "../src/ground-fx-picture"
import { compileGroundFx, groundFxSpec, groundFxStarts, groundFxTextures } from "../src/common/ground-fx"
import { compileProjectiles, projectileImpactNeeds } from "../src/common/projectiles"
import { compileAbilities } from "../src/fabric/entity-abilities"
import { compileEffects } from "../src/fabric/effect"
import { impactLines, projectileLines, projectileSketch } from "../src/ability-projectile"
import { abilityParticleIds } from "../src/ability-trails"
import { creatureVanillaGaps } from "../src/version-lacks"
import { decodeRgbaPng } from "../src/png-decode"
import { genTarget } from "../src/platform/target"
import type { TargetId } from "../src/target/ids"
import { createTargetGroundFxSample, rayAbility, scorchAbility, voidRainAbility } from "../script/target-groundfx-sample"
import { fightingGolemDesign as golemSample, golemEffects } from "../script/data-gameplay-sample"
import { rainAbility } from "../script/target-projectile-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * 第 4 步 (效果和表现): ground hazards, cracks, shockwave rings and beams — what may be written, what is said and drawn of them, the Java a creature and a thrown thing write, the
 * runtime's classes and pictures, the additive glow of effects and the thrown things that look like them, and a whole mod using all of it compiled for every target.
 */

const design = golemSample as unknown as ModelDesign
test("hit feedback expands the three levels at the requested tick, with local particle fallback", () => {
  const asset = { asset: "1de12101-8581-4754-95d5-db4890cc337e" }
  for (const [level, count] of [["light",3],["medium",4],["heavy",6]] as const) {
    const cue = { type:"hit_fx", at:0.5, where:"hit", hit:0, level, color:"#fabb43" } as const
    const steps = expandFeedback([cue], {hit:asset})
    expect(steps).toHaveLength(count)
    expect(steps.every(s => s.at === 0.5)).toBe(true)
    expect(steps.find(s => s.type === "particle")?.particle).toEqual(asset)
    expect(expandFeedback([cue]).find(s => s.type === "particle")?.particle).toBe("crit")
  }
})

test("flash textures are 64 pixels and the arc angle changes their coverage", () => {
  const make = (arc: number) => FlashEventSchema.parse({type:"flash", at:0, shape:"arc", radius:2, color:"#ffaa66", arc})
  const flashes = [make(60), make(180)]
  const textures = groundFxTextures("ember", flashes)
  const images = [60, 180].map(angle => decodeRgbaPng(textures[`src/main/resources/assets/ember/textures/fx/arc_${angle}.png`]!))
  expect(images.map(image => [image.width, image.height])).toEqual([[64,64],[64,64]])
  expect(groundFxSpec(flashes[0]!)).toContain("4, 6, 0, 6")
  expect(textures["src/main/resources/assets/ember/textures/fx/arc_60.png"]).not.toEqual(textures["src/main/resources/assets/ember/textures/fx/arc_180.png"])
})

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const messages = (result: { error?: { issues: { message: string }[] } }) => (result.error?.issues ?? []).map((issue) => issue.message)
const withEvents = (ability: Ability, events: unknown[]) => AbilitySchema.safeParse({ ...ability, events })

test("square hazard growth cannot cap below its initial half-width", () => {
  const event = { ...scorchAbility.events[0], shape: "square", growth: { per_second: 1, per_hit: 0.25, max_radius: 6 } }
  expect(withEvents(scorchAbility, [event]).success).toBe(true)
  expect(messages(withEvents(scorchAbility, [{ ...event, growth: { ...event.growth, max_radius: 1 } }])).join()).toContain("起始半径")
})

test("a target beam takes one pursuit speed and shows walking and sprinting beside it", () => {
  const event = rayAbility.events[0]
  if (event?.type !== "beam") throw Error("beam expected")
  const {turn,...base}=event
  const sweep={blocks_per_second:5}
  const ability=AbilitySchema.parse({...rayAbility,events:[{...base,sweep}]})
  const beam=ability.events[0]
  if(beam?.type!=="beam") throw Error("beam expected")
  expect(groundFxWords(beam)).toContain("4.3、疾跑 5.6")
  expect(groundFxSpec(beam)).toContain("-5.0f")
  expect(withEvents(ability,[{...base,turn:3,sweep}]).success).toBe(false)
  expect(withEvents(ability,[base]).success).toBe(false)
})

test("a grouped ring and area share one cast and preserve each target's hit record", () => {
  const member = { once_group: "slam" }
  const ability = AbilitySchema.parse({...scorchAbility,hits:[{...scorchAbility.hits[0],...member}],events:[{...scorchAbility.events[2],...member}]})
  const java = compileAbilities({entity:"TestCreature",model:"flame",abilities:[ability],hostile:true,runtime:false,death:false})
  expect(java.methods).toContain('onceHits.group("slam", false, true)')
  expect(java.methods).toContain("group.mark(victim)")
  expect(java.methods).toContain("onceHits.nextCast()")
  expect(withEvents(ability,[{...scorchAbility.events[2],once_skip_effects:false}]).success).toBe(false)
})

test("a shockwave warns at its starting band and optionally draws the farthest edge", () => {
  const event = { ...scorchAbility.events[2], where: "self", hit: null, from_radius: 2, to_radius: 6, width: 1,
    warn: { seconds: 0.4, look: "ring", color: "orange", extent: "max" } }
  const ability = AbilitySchema.parse({ ...scorchAbility, events: [event] })
  const [picture] = groundFxPictures(ability, { bones: [], animations: [] })
  expect(picture!.time).toBeCloseTo(0.3)
  expect(picture!.lines.map(line => Math.max(...line.points.map(([x,,z]) => Math.hypot(x,z))) / 16)).toEqual([1.5,2.5,6.5].map(value => expect.closeTo(value)))
  expect(picture!.lines[2]!.dashed).toBe(true)
  expect(picture!.caption.join()).toContain("虚线")
  expect(messages(withEvents(ability, [{ ...event, warn: { ...event.warn, seconds: 0.8 } }])).join()).toContain("最多提前")
})

test("a low shockwave has a separate damage ceiling and keeps a single victim set", () => {
  const event = { ...scorchAbility.events[2], hit_height: 0.35 }
  const ability = AbilitySchema.parse({ ...scorchAbility, events: [event] })
  const ring = ability.events[0]!
  if (ring.type !== "shockwave") throw new Error("expected shockwave")
  expect(groundFxWords(ring)).toContain("可以跳过去")
  expect(groundFxSpec(ring)).toContain("0.35f)")
  expect(withEvents(scorchAbility, [{ ...event, hit_height: 0 }]).success).toBe(false)
  for (const target of Object.keys(CLASSPATH) as TargetId[]) {
    const files = compileGroundFx({ modId: "camp", packageName: "com.camp", hitHeight: true }, genTarget(target)).files
    const source = Object.values(files).join("\n")
    expect(source).toContain("getY() + spec.hitHeight()")
    expect(source).toContain("!struck.add(victim.getId())")
  }
})

test("what may be written: the four events, their bounds, where they are put down, when they may hurt", () => {
  for (const ability of [scorchAbility, rayAbility, voidRainAbility]) expect(AbilitySchema.safeParse(ability).success).toBe(true)
  const [hazard, crack, ring] = scorchAbility.events as unknown as Record<string, unknown>[]
  const beam = rayAbility.events[0] as unknown as Record<string, unknown>
  // Bounds and fields of no such event are refused by the schema.
  for (const wrong of [{ ...hazard, radius: 9 }, { ...hazard, every_ticks: 4 }, { ...hazard, color: "red" }, { ...crack, grow_seconds: 3 }, { ...ring, to_radius: 33 }, { ...beam, length: 49 }, { ...beam, turn: 31 }, { ...crack, damage: 2 }])
    expect(withEvents(scorchAbility, [wrong]).success).toBe(false)
  // A ring that does not grow; a beam that ends before it starts or after the ability; one that hurts before the wind-up is over.
  expect(messages(withEvents(scorchAbility, [{ ...ring, to_radius: 0.5 }])).join()).toContain("要比开始的半径（from_radius）大")
  expect(messages(withEvents(rayAbility, [{ ...beam, until: 0.5 }])).join()).toContain("要比开始（at）晚")
  expect(messages(withEvents(rayAbility, [{ ...beam, until: 1.7 }])).join()).toContain("不能比招式全长（length）还晚")
  expect(messages(withEvents(scorchAbility, [{ ...hazard, at: 0.2 }])).join()).toContain("地面危险区会伤人")
  expect(withEvents(scorchAbility, [{ ...crack, at: 0.2 }]).success).toBe(true)
  // where/hit agree; a hit it does not have; one written in code; a thrown thing (its landing is `impact.ground`); a hit put down elsewhere.
  expect(messages(withEvents(scorchAbility, [{ ...hazard, where: "hit", hit: null }])).join()).toContain('where 写 "hit" 的时候')
  expect(messages(withEvents(scorchAbility, [{ ...hazard, where: "hit", hit: 3 }])).join()).toContain("没有第 3 次")
  expect(messages(withEvents(voidRainAbility, [{ ...hazard, at: 1, where: "hit", hit: 0 }])).join()).toContain("impact.ground")
  const elsewhere = { ...scorchAbility, hits: [{ ...scorchAbility.hits[0], place: "target" }] }
  expect(withEvents(elsewhere as Ability, [{ ...ring, at: elsewhere.hits[0]!.at, where: "hit", hit: 0 }]).success).toBe(true)
  expect(messages(withEvents(elsewhere as Ability,[{ ...ring, at: 0, where:"hit", hit:0 }])).join()).toContain("最早能放在")
  // 落地炸开 with ground: allowed alone; a ring there must grow too; nothing at all is still refused.
  const rained = (impact: unknown) => AbilitySchema.safeParse({ ...rainAbility, hits: [{ ...rainAbility.hits[0], impact }] })
  expect(rained({ ground: [{ type: "crack", radius: 2, seconds: 3, grow_seconds: 0, color: "#000000", glow: false }] }).success).toBe(true)
  expect(messages(rained({ ground: [{ type: "shockwave", from_radius: 3, to_radius: 2, seconds: 1, width: 1, height: 0, color: "#ffffff", glow: true, damage: 0, knockback: 0, hits: "everyone", effects: [] }] })).join()).toContain("要比开始的半径（from_radius）大")
  expect(rained({ ground: [] }).success).toBe(false)
  expect(messages(rained({})).join()).toContain("ground（地面危险区、地裂、冲击波环）至少写一样")
})

test("a hazard or a beam that hurts lasts at least until its first strike; the boundary itself is allowed (that strike lands on its last tick)", () => {
  const hazard = scorchAbility.events[0] as unknown as Record<string, unknown>
  const beam = rayAbility.events[0] as unknown as Record<string, unknown>
  // 0.5 seconds is 10 ticks: a strike every 10 lands once, on its last tick; a strike every 15 never does.
  expect(withEvents(scorchAbility, [{ ...hazard, seconds: 0.5, every_ticks: 10, damage: 6 }]).success).toBe(true)
  const refused = messages(withEvents(scorchAbility, [{ ...hazard, seconds: 0.5, every_ticks: 15, damage: 6 }]))
  expect(refused).toEqual(["地面危险区只留 0.5 秒（10 刻），可它放下以后要过 every_ticks 15 刻才第一次伤人：还没伤到人就没了。把 seconds 写到至少 0.75 秒，或者把 every_ticks 写小一点"])
  // One that only shows is not held to it.
  expect(withEvents(scorchAbility, [{ ...hazard, seconds: 0.5, every_ticks: 15, damage: 0, effects: [], burn_seconds: 0 }]).success).toBe(true)
  // A beam from 0.5 to 0.7 seconds is 4 ticks: every 5 never strikes, every 4 strikes once.
  expect(messages(withEvents(rayAbility, [{ ...beam, until: 0.7, every_ticks: 5 }])).join()).toContain("光束从 at 到 until 只有 0.2 秒（4 刻）")
  expect(withEvents(rayAbility, [{ ...beam, until: 0.7, every_ticks: 4 }]).success).toBe(true)
  // Where a thrown thing comes down, the same.
  const rained = (ground: unknown[]) => AbilitySchema.safeParse({ ...rainAbility, hits: [{ ...rainAbility.hits[0], impact: { ground } }] })
  const pool = { type: "hazard", radius: 2, seconds: 0.5, color: "#7a2aff", glow: true, damage: 2, hits: "everyone", effects: [], every_ticks: 20 }
  expect(messages(rained([pool])).join()).toContain("地面危险区只留 0.5 秒（10 刻），可它放下以后要过 every_ticks 20 刻")
  expect(rained([{ ...pool, seconds: 1 }]).success).toBe(true)
  expect(GROUND_FX_INSTRUCTIONS).toContain("伤人的危险区 seconds 不能比 every_ticks 短")
})

test("the runtime's clock, its last tick and its strikes: one age for the server and every player's game, every tick of its life acted on, every strike landing", () => {
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
    const made = compileGroundFx({ modId: "ground_fire_camp", packageName: "com.minemods.ground_fire_camp" }, genTarget(target))
    const entity = String(made.files["src/main/java/com/minemods/ground_fire_camp/entity/StudioFx.java"])
    const renderer = String(made.files["src/main/java/com/minemods/ground_fire_camp/client/StudioFxRenderer.java"])
    // The game time it was put down at is synced with it: a player whose game begins to see it halfway draws it at its age then, by the same clock the server runs it by.
    expect(entity).toContain("private static final EntityDataAccessor<Integer> BORN = SynchedEntityData.defineId(StudioFx.class, EntityDataSerializers.INT);")
    expect(entity).toContain("getEntityData().set(BORN, (int) level().getGameTime());")
    expect(entity).toContain("public float age(float partialTick) { return (int) level().getGameTime() - getEntityData().get(BORN) + partialTick; }")
    expect(entity).toContain("lived = (int) level().getGameTime() - getEntityData().get(BORN);")
    expect(renderer).toContain("float age = fx.age(partialTick);")
    expect(renderer).not.toContain("fx.tickCount")
    expect(entity).not.toContain("++lived")
    // It acts on its last tick, then is gone.
    const tick = entity.slice(entity.indexOf("@Override public void tick()"), entity.indexOf("private void hazard()"))
    expect(tick.indexOf("case SHOCKWAVE -> shockwave();")).toBeLessThan(tick.indexOf("if (lived >= spec.life() && !isRemoved()) discard();"))
    // Every strike lands: the game's half second of sparing is let go first; the game's own push at most once every SPARED ticks.
    const strike = entity.slice(entity.indexOf("private void strike("), entity.indexOf("// Never written to disk"))
    expect(strike.indexOf("victim.invulnerableTime = 0;")).toBeLessThan(strike.indexOf("victim.hurt(source, spec.damage() * scale)"))
    expect(strike).toContain("boolean push = last == null || lived - last >= SPARED;")
    expect(strike).toContain("victim.setDeltaMovement(motion);")
    expect(entity).toContain("private static final int SPARED = 10;")
  }
})

test("what it depends on and what is said of it: particle assets, version gaps, words, instructions, bones", () => {
  const PARTICLE = "b2b2b2b2-0000-4000-8000-0000000000aa"
  const own = AbilitySchema.parse({ ...scorchAbility, events: [{ ...scorchAbility.events[0], particle: { asset: PARTICLE } }] })
  expect(abilityParticleIds([own])).toEqual([PARTICLE])
  expect(groundFxParticleAssets(allGroundFx([own]))).toEqual([PARTICLE])
  expect(abilitiesGroundFx([voidRainAbility])).toBe(true)
  expect(abilitiesGroundFx([rainAbility])).toBe(false)
  // A vanilla particle 1.20.1 lacks, on a hazard and on one left where a thrown thing lands.
  const plume = AbilitySchema.parse({ ...scorchAbility, events: [{ ...scorchAbility.events[0], particle: "dust_plume" }] })
  expect(creatureVanillaGaps({ name: "炎魔", abilities: [plume] }, "1.20.1").map((gap) => gap.text).join()).toContain("地面危险区（hazard）用了原版的")
  expect(creatureVanillaGaps({ name: "炎魔", abilities: [plume] }, "1.21.1")).toEqual([])
  const words = abilityWords.events(scorchAbility)
  expect(words).toContain("第 0.7 秒在它脚下（再往前 1.5 格、往左 0 格）放下半径 3 格的地面危险区（#ff5a1a，发光），留 5 秒：站在里面每 0.5 秒掉 2 点血、着火 3 秒（除了它和同类以外谁都打），冒火苗粒子")
  expect(words).toContain("目标脚下放下半径 4 格的地裂")
  expect(words).toContain("1.2 秒里从半径 0.5 格扩到 10 格：环扫过的人掉 4 点血、被往外推开（除了它和同类以外谁都打），每人只挨一次")
  expect(abilityWords.events(rayAbility)).toContain("从「head」（再往前 0.4、往上 0、往左 0 格）射出一道宽 0.6 格的光束（#ff3010，发光），对着目标（每刻最多转 3° 去追）")
  expect(abilityWords.hit(voidRainAbility.hits[0]!)).toContain("留下半径 2 格的地面危险区（#7a2cff，发光）")
  const voidHit = voidRainAbility.hits[0]!
  expect(voidHit.type === "projectile" && groundFxWords(voidHit.impact!.ground![1]!)).toContain("地裂（#1c1420）")
  expect(ABILITY_INSTRUCTIONS).toContain(GROUND_FX_INSTRUCTIONS)
  expect(GROUND_FX_INSTRUCTIONS).toContain('在该位置的 particle 或 sound 写字符串 "none"，可分别关闭该位置自带的粒子或声音；省略哪个字段，哪个就沿用默认。')
  expect(GROUND_FX_INSTRUCTIONS).toContain('builtin:{weak_hit:{particle:"none"},leave:{sound:"none"}}')
  for (const field of ['{type:"hazard"', '{type:"crack"', '{type:"shockwave"', '{type:"beam"', "ground:[…]"]) expect(GROUND_FX_INSTRUCTIONS).toContain(field)
  // A beam from a part the model lacks stops, as every part a creature names.
  const lost = AbilitySchema.parse({ ...rayAbility, events: [{ ...rayAbility.events[0], bone: "horn" }] })
  expect(boneIssues({ name: "炎魔", abilities: [lost] }, design).map((issue) => [issue.stops, issue.text.includes("光束")])).toEqual([[true, true]])
  expect(boneIssues({ name: "炎魔", abilities: [rayAbility] }, design)).toEqual([])
})

test("the pictures: every ground effect and beam in its colour where the game puts it, and a star where a thrown thing bursts", () => {
  const pictures = groundFxPictures(scorchAbility, design)
  expect(pictures.map((picture) => picture.event.type)).toEqual(["hazard", "crack", "shockwave"])
  // The hazard's circle is 3 blocks (48 model pixels) round 1.5 blocks ahead of its feet; the crack is at the target, 6 blocks ahead (the middle of its window); the ring reaches 10 blocks.
  const hazard = pictures[0]!.lines[0]!.points
  const reach = Math.max(...hazard.map((point) => Math.hypot(point[0], point[2] + 1.5 * 16)))
  expect(reach).toBeCloseTo(48, 3)
  expect(pictures[0]!.lines[0]!.color).toBe("#ff5a1a")
  const crack = pictures[1]!.lines.flatMap((line) => line.points)
  expect(crack[0]![2]).toBeCloseTo(-4 * 16, 3)
  expect(Math.max(...pictures[2]!.lines.flatMap((line) => line.points).map((point) => Math.hypot(point[0], point[2] + 1.5 * 16)))).toBeCloseTo(160, 0)
  expect(pictures[2]!.caption.join()).toContain("冲击波环")
  // The beam starts at the middle of the head (plus its own offset) and reaches the target.
  const beam = groundFxPictures(rayAbility, design)[0]!
  expect(beam.lines[0]!.points[1]![2]).toBeLessThan(beam.lines[0]!.points[0]![2])
  const starts = groundFxStarts([rayAbility], design)!
  expect(starts[0]![0]!.up).toBeGreaterThan(1)
  // 落地炸开: a star at every landing (four strokes each) and the void pool's circles and the crack's strokes there; said under the cell with when it bursts.
  const sketch = projectileSketch(voidRainAbility, 0, design)!
  const lines = impactLines(voidRainAbility, sketch)
  expect(lines.filter((line) => line.color === "#ffcc22")).toHaveLength(4 * 4)
  expect(lines.some((line) => line.color === "#7a2cff")).toBe(true)
  expect(projectileLines(voidRainAbility, sketch).join()).toContain("落地的那一刻在落点炸开（图上每个落点画成金色的星，留在地上的画成它的范围）")
  expect(impactLines(rainAbility, projectileSketch(rainAbility, 0, design)!).length).toBe(12 * 4)
})

test("the Java: a creature's statements and its one method; a thrown thing's ground; nothing differs for anyone without", () => {
  const spec = groundFxSpec(scorchAbility.events[0] as never)
  expect(spec).toBe('new StudioFxSpec(0, 100, 10, 20, 3.0f, 0.0f, 0.0f, 0.0f, 0xff5a1a, true, 2.0f, 0.0, 10, true, 60, new int[] {}, "flame", null, 6, 0.0f, 0.0f, 0.0f, false, 0.0f)')
  expect(groundFxSpec(rayAbility.events[0] as never, { forward: 0.4, up: 1.6, left: 0 })).toBe("new StudioFxSpec(3, 22, 4, 5, 0.6f, 24.0f, 0.0f, 0.0f, 0xff3010, true, 3.0f, 0.0, 5, true, 0, new int[] {3, 60, 0}, null, null, 0, 0.4f, 1.6f, 0.0f, false, 3.0f)")
  const input = { entity: "StudioCreatureFlame", model: "flame", abilities: [scorchAbility, rayAbility], hostile: true, runtime: false, death: false, boss: { tracker: "" } }
  const java = compileAbilities({ ...input, groundStarts: groundFxStarts(input.abilities, design)! })
  expect(java.fields).toContain("private static final StudioFxSpec[] ABILITY_GROUND = {")
  expect(java.methods).toContain("StudioFx.start(level(), spec, origin.add(")
  expect(java.methods).toContain("abilityTarget, bossDamageScale(), () -> abilityIndex < 0 ? -1 : (abilitySerial << 8) | abilityIndex);")
  const steps = java.methods
  expect(steps).toContain("abilityGround(ABILITY_GROUND[0], abilityPoint(0.0, 0.0, 0.0), 1.5, 0.0);")
  expect(steps).toContain("abilityGround(ABILITY_GROUND[1], abilityTarget.position(), 0.0, 0.0);")
  expect(steps).toContain("abilityGround(ABILITY_GROUND[2], abilityPoint(1.5, 0.5, 0.0), 0.0, 0.0);")
  expect(steps).toContain("abilityGround(ABILITY_GROUND[3], position(), 0.0, 0.0);")
  // Without any: the very same class as before (the scorch with its four events taken out against the same ability without them).
  const plain = AbilitySchema.parse({ ...scorchAbility, events: [scorchAbility.events[3]] })
  const before = compileAbilities({ ...input, abilities: [plain] })
  expect(before.fields).not.toContain("StudioFx")
  expect(before.methods).not.toContain("abilityGround")
  // A thrown thing: the ground it leaves is the Impact's last argument and the burst starts each; one without is written as it always was.
  const needs = projectileImpactNeeds([voidRainAbility.hits[0] as never])!
  expect(needs.ground).toBe(true)
  const files = compileProjectiles({ modId: "ground_fire_camp", packageName: "com.minemods.ground_fire_camp", effects: true, warned: true, impact: needs }).files
  const table = files["src/main/java/com/minemods/ground_fire_camp/entity/StudioProjectiles.java"]!
  expect(table).toContain("int ticks, StudioFxSpec[] ground) {")
  expect(files["src/main/java/com/minemods/ground_fire_camp/entity/StudioProjectile.java"]).toContain("if (impact.ground() != null) for (StudioFxSpec fx : impact.ground()) StudioFx.start(world, fx, point, getYRot(), owner, null, scale, null);")
  const lean = compileProjectiles({ modId: "ground_fire_camp", packageName: "com.minemods.ground_fire_camp", effects: true, warned: true, impact: { ...needs, ground: false } }).files
  expect(lean["src/main/java/com/minemods/ground_fire_camp/entity/StudioProjectile.java"]).not.toContain("StudioFx")
  expect(compileProjectiles({ modId: "ground_fire_camp", packageName: "com.minemods.ground_fire_camp", effects: true, warned: true, impact: { effects: false, own: false, shake: false } }).files).toEqual(compileProjectiles({ modId: "ground_fire_camp", packageName: "com.minemods.ground_fire_camp", effects: true, warned: true, impact: { effects: false, own: false, shake: false, ground: false } }).files)
})

test("the runtime: one entity type, its renderer per Minecraft, its four pictures; effects drawn added only when one says so", () => {
  const fabric = compileGroundFx({ modId: "ground_fire_camp", packageName: "com.minemods.ground_fire_camp" })
  const pkg = "src/main/java/com/minemods/ground_fire_camp"
  expect(Object.keys(fabric.files).filter((name) => name.endsWith(".java")).sort()).toEqual([`${pkg}/client/StudioFxClient.java`, `${pkg}/client/StudioFxRenderer.java`, `${pkg}/entity/StudioFx.java`, `${pkg}/entity/StudioFxSpec.java`, `${pkg}/entity/StudioFxTypes.java`])
  expect(String(fabric.files[`${pkg}/client/StudioFxRenderer.java`])).toContain("out.addVertex(pose.pose(), x, y, z).setColor(red, green, blue, alpha)")
  expect(String(fabric.files[`${pkg}/entity/StudioFx.java`])).not.toContain("StudioParticles")
  expect(String(compileGroundFx({ modId: "ground_fire_camp", packageName: "com.minemods.ground_fire_camp", own: true }).files[`${pkg}/entity/StudioFx.java`])).toContain("StudioParticles.byAsset(spec.own())")
  const forge = compileGroundFx({ modId: "ground_fire_camp", packageName: "com.minemods.ground_fire_camp" }, genTarget("forge-1.20.1"))
  expect(String(forge.files[`${pkg}/client/StudioFxRenderer.java`])).toContain(".uv2(light).normal(pose.normal(), 0.0f, 1.0f, 0.0f).endVertex();")
  expect(String(forge.files[`${pkg}/entity/StudioFxTypes.java`])).toContain('StudioPlatform.entity("studio_fx",')
  expect(forge.entries.common).toEqual(["com.minemods.ground_fire_camp.entity.StudioFxTypes"])
  // The pictures: square, the soft disc whole in the middle and nothing at its corner; the crack's glowing picture black where its plain one is see-through.
  const textures = groundFxTextures("ground_fire_camp")
  const soft = decodeRgbaPng(textures["src/main/resources/assets/ground_fire_camp/textures/fx/soft.png"]!)
  expect([soft.width, soft.height]).toEqual([64, 64])
  expect(soft.pixels[(32 * 64 + 32) * 4 + 3]).toBeGreaterThan(240)
  expect(soft.pixels[3]).toBe(0)
  const crack = decodeRgbaPng(textures["src/main/resources/assets/ground_fire_camp/textures/fx/crack_glow.png"]!)
  const lit = Array.from({ length: crack.width * crack.height }, (_, index) => crack.pixels[index * 4]!).filter((value) => value > 128).length
  expect(lit / (crack.width * crack.height)).toBeGreaterThan(0.01)
  expect(lit / (crack.width * crack.height)).toBeLessThan(0.3)
  // Additive effects: only when one says so; the thrown things that look like them too.
  const spike = { id: "b2b2b2b2-0000-4000-8000-0000000000f4", title: "晶刺", document: golemEffects.spike.document as never as Parameters<typeof compileEffects>[0]["effects"][number]["document"] }
  const normal = compileEffects({ modId: "m", packageName: "com.m.m", effects: [spike] })
  const added = compileEffects({ modId: "m", packageName: "com.m.m", effects: [{ ...spike, document: { ...spike.document, play: { ...spike.document.play, blend: "additive" } } }] })
  expect(normal.additive).toBe(false)
  expect(String(normal.files["src/main/java/com/m/m/client/StudioEffectRenderer.java"])).not.toContain("eyes")
  expect(added.additive).toBe(true)
  expect(String(added.files["src/main/java/com/m/m/client/StudioEffectRenderer.java"])).toContain("StudioEffects.ADDITIVE[effect.kind()] ? RenderType.eyes(texture) : ")
  const thrown = compileProjectiles({ modId: "m", packageName: "com.m.m", effects: true, warned: false, additive: true }).files["src/main/java/com/m/m/client/StudioProjectileRenderer.java"]!
  expect(thrown).toContain("StudioEffects.additive(thrown.model()) ? RenderType.eyes(texture)")
  expect(compileProjectiles({ modId: "m", packageName: "com.m.m", effects: true, warned: false }).files["src/main/java/com/m/m/client/StudioProjectileRenderer.java"]).not.toContain("RenderType")
  expect(GROUND_FX_LIMITS.alive).toBe(32)
})

async function sample(target: TargetId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-groundfx-"))
  roots.push(root)
  await createTargetGroundFxSample(path.join(root, "地火营"), target)
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(path.join(root, "地火营"), source, TEMPLATE)
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
  return { source, built, names, read: (name: string) => readFile(path.join(source, name), "utf8") }
}

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: a mod with every ground effect, a beam, a thrown thing's ground and an additive effect is generated, wired to the loader, and compiles`, async () => {
    const { built, names, read, source } = await sample(target)
    const pkg = "src/main/java/com/minemods/content_ground_fire_camp"
    for (const name of ["entity/StudioFx.java", "entity/StudioFxSpec.java", "entity/StudioFxTypes.java", "client/StudioFxClient.java", "client/StudioFxRenderer.java"]) expect(names).toContain(`${pkg}/${name}`)
    for (const picture of ["soft", "soft_glow", "crack", "crack_glow"]) expect(names).toContain(`src/main/resources/assets/ground_fire_camp/textures/fx/${picture}.png`)
    expect(built.groundFxFiles).toContain("com/minemods/content_ground_fire_camp/entity/StudioFx.class")
    if (target === "fabric-1.21.1") {
      const metadata = JSON.parse(await read("src/main/resources/fabric.mod.json"))
      expect(metadata.entrypoints.main).toContain("com.minemods.content_ground_fire_camp.entity.StudioFxTypes")
      expect(metadata.entrypoints.client).toContain("com.minemods.content_ground_fire_camp.client.StudioFxClient")
    } else {
      expect(await read(`${pkg}/StudioContent.java`)).toContain("com.minemods.content_ground_fire_camp.entity.StudioFxTypes.register();")
      expect(await read(`${pkg}/client/StudioClient.java`)).toContain("com.minemods.content_ground_fire_camp.client.StudioFxClient.register();")
    }
    const flame = await read(names.find((name) => /entity\/StudioCreatureEntity1_\w+\.java$/.test(name))!)
    expect(flame).toContain("ABILITY_GROUND")
    expect(flame).toContain("abilityGround(ABILITY_GROUND[3], position(), 0.0, 0.0);")
    // The beam is keyed to the run of the ability (its number and the count of starts), which a stage switching to its own motion does not change.
    expect(flame).toContain("() -> abilityIndex < 0 ? -1 : (abilitySerial << 8) | abilityIndex);")
    expect(flame).toContain("abilityStageSerial")
    const thrown = await read(`${pkg}/entity/StudioProjectile.java`)
    expect(thrown).toContain("StudioFx.start(world, fx, point")
    expect(await read(`${pkg}/client/StudioEffectRenderer.java`)).toContain("RenderType.eyes(texture)")
    expect(await read(`${pkg}/client/StudioProjectileRenderer.java`)).toContain("StudioEffects.additive(thrown.model())")
    // A check script's probe goes into the entries on every target (target-groundfx-client.ts): Fabric's are its two entry points, first in them.
    const entries: Record<string, string | Uint8Array> = { [`${pkg}/StudioContent.java`]: await read(`${pkg}/StudioContent.java`), [`${pkg}/client/StudioClient.java`]: await read(`${pkg}/client/StudioClient.java`) }
    addEntryCalls(entries, "com.minemods.content_ground_fire_camp", { common: ["com.minemods.content_ground_fire_camp.ProbeCommon"], client: ["com.minemods.content_ground_fire_camp.client.ProbeClient"] })
    const [common, client] = target === "fabric-1.21.1" ? ["public void onInitialize() {", "public void onInitializeClient() {"] : ["public static void register() {", "public static void register() {"]
    expect(String(entries[`${pkg}/StudioContent.java`])).toContain(`${common}\n        com.minemods.content_ground_fire_camp.ProbeCommon.register();`)
    expect(String(entries[`${pkg}/client/StudioClient.java`])).toContain(`${client}\n        com.minemods.content_ground_fire_camp.client.ProbeClient.register();`)
    await Promise.all([
      ...Object.entries(entries).map(([name, text]) => writeFile(path.join(source, name), text)),
      writeFile(path.join(source, pkg, "ProbeCommon.java"), "package com.minemods.content_ground_fire_camp;\n\npublic final class ProbeCommon {\n    public static void register() {}\n}\n"),
      writeFile(path.join(source, pkg, "client", "ProbeClient.java"), "package com.minemods.content_ground_fire_camp.client;\n\npublic final class ProbeClient {\n    public static void register() {}\n}\n"),
    ])
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src/main/java"))
    expect(compiled.output).not.toContain("error")
    expect(compiled.code).toBe(0)
  }, 240000)
}

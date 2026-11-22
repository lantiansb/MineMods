import { expect, test } from "bun:test"
import { EFFECT_ZONE_TOLERANCE } from "../src/ability-words"
import { AIM_TARGET, aimPitch, hitLines, levelReach, shapeAims, shapeFaces, shapeGap, abilityHitShapes } from "../src/creature-abilities"
import { readGeneratedCreature } from "../src/creature-contract"
import { EffectDocumentSchema } from "../src/effect"
import { abilityEffectIssues, abilityEffectLines, aimStands, effectAimGap, effectAtHit, effectDisagrees, effectPlaces, eventFrame, grounded, type EffectEvent } from "../src/effect-abilities"
import { AbilitySchema, type Ability } from "../src/entity-runtime"
import { compileEffects } from "../src/fabric/effect"
import { compileAbilities } from "../src/fabric/entity-abilities"
import { fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"

/**
 * J2 (round 10): what is shown and what is hit agree when the target does not stand level with what aims at it.
 * A stream two blocks long stretched to nine, shown by a breath whose line aims at its target.
 */
const ID = "22222222-2222-4222-8222-aaaaaaaaaaaa"
const side = { north: "#DDF6FF", east: "#DDF6FF", south: "#DDF6FF", west: "#DDF6FF", up: "#FFFFFF", down: "#9FD8EE" }
const stream = EffectDocumentSchema.parse({
  kind: "effect",
  name: "stream",
  texture_size: 64,
  bones: [{ name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ name: "core", origin: [-3, -3, -32], size: [6, 6, 32], faces: side, surface_details: [] }] }],
  animations: [{ name: "blow", length: 0.8, loop: false, channels: [{ bone: "root", keyframes: [], scale: [{ time: 0, scale: [0.4, 0.4, 0.2] }, { time: 0.15, scale: [1, 1, 4.5] }, { time: 0.8, scale: [0.2, 0.2, 4.5] }] }] }],
  play: { clip: "blow", lifetime: 0.8, follow: false, facing: "owner", on_ground: false, ends_with_owner: false, bright: true, opacity: 1 },
})
const lookup = (id: string) => (id === ID ? { title: "气流", document: stream } : null)
const UP = 1.9
const breath = (shape: Record<string, unknown> = {}, event: Record<string, unknown> = {}): Ability =>
  AbilitySchema.parse({
    ...golemAbilities[1],
    id: "breath",
    name: "吐息",
    hits: [{ type: "area", at: 1, shape: { type: "line", up: UP, length: 9, radius: 0.6, ...shape }, hits: "target", damage: 5, knockback: 1, effects: [] }],
    start: { ...golemAbilities[1].start, min_distance: 4, max_distance: 10 },
    events: [{ type: "effect", at: 1, effect: ID, where: "self", hit: null, forward: 0.4, up: UP, left: 0, count: 1, layout: "line", spread: 0, ...event }],
  })
const event = (ability: Ability) => ability.events[0] as EffectEvent
const compiled = (ability: Ability) => compileAbilities({ entity: "StudioCreature", model: "creature", abilities: [ability], hostile: true, runtime: false, death: true }).methods
const TALL = 2

test("a beam tilts about where it starts: its faces and the distance to it are the same arithmetic the generated aim does", () => {
  const shape = breath().hits[0]!
  if (shape.type !== "area") throw new Error("area")
  // The target on the same ground, seven blocks ahead: the aim from 1.9 up to the middle of a player points down.
  const stand = aimStands(breath())[0]!
  expect(stand).toMatchObject({ distance: 7, height: 0, words: "站在同一块地上" })
  const pitch = aimPitch(UP, 0, stand)
  expect(pitch).toBeCloseTo(Math.atan2(AIM_TARGET.middle - UP, 7), 12)
  // Every corner of the tilted beam's faces is on the tilted beam; the far ones are off the level one.
  const faces = shapeFaces(shape.shape, pitch).flat()
  expect(Math.max(...faces.map((point) => shapeGap(shape.shape, point, pitch)))).toBeLessThan(1e-9)
  expect(Math.max(...faces.map((point) => shapeGap(shape.shape, point)))).toBeGreaterThan(8)
  // Level, nothing changes: the pictures drawn before are what they were.
  expect(shapeFaces(shape.shape, 0)).toEqual(shapeFaces(shape.shape))
  expect(aimStands(breath(), TALL).map((value) => value.height)).toEqual([0, TALL])
})

test("an effect laid out level against a hit that aims comes apart when the target is not level: a finding, with the way out", () => {
  const level = breath()
  expect(eventFrame(level, event(level))).toEqual({ along: "facing" })
  const found = effectAimGap(level, event(level), 0, lookup(ID), TALL)!
  // On level ground the stream lies in the beam, which is why no other picture shows anything wrong.
  expect(found.level).toBe(0)
  expect(found.stands.map((stand) => stand.tilt)).toEqual([-8.1, 8.1])
  expect(found.worst.gap).toBeGreaterThan(EFFECT_ZONE_TOLERANCE)
  expect(found.disagrees).toBe(true)
  const said = abilityEffectLines(level, lookup, TALL).filter(effectDisagrees)
  expect(said).toHaveLength(1)
  expect(said[0]).toContain("对不上：第 1 次出手是朝目标瞄的")
  expect(said[0]).toContain('写 along:"aim"、hit:0')
  expect(said[0]).toContain('写上 aim:"level"')
  expect(abilityEffectIssues({ name: "石像", abilities: [level] }, lookup, TALL)).toMatchObject([{ ability: "breath", rule: "effect_zone", stops: false }])
  // Without the model nothing is known of how tall it is: the same ground is still measured.
  expect(abilityEffectIssues({ name: "石像", abilities: [level] }, lookup).map((issue) => issue.rule)).toEqual(["effect_zone"])
})

test("along the aim the whole layout turns with the hit as one piece: the same event with along and hit agrees at every height", () => {
  const along = breath({}, { hit: 0, along: "aim" })
  expect(eventFrame(along, event(along))).toEqual({ along: "aim", hit: 0, up: UP, forward: 0 })
  const found = effectAimGap(along, event(along), 0, lookup(ID), TALL)!
  expect(found.stands.map((stand) => stand.gap)).toEqual([0, 0])
  expect(found.disagrees).toBe(false)
  expect(abilityEffectIssues({ name: "石像", abilities: [along] }, lookup, TALL)).toEqual([])
  expect(abilityEffectLines(along, lookup, TALL).join("")).toContain("是顺着这个方向摆的（along 写的是 aim），位置和朝向跟着一起倾斜")
  // Level, it stands exactly where the level event put it; tilted, it has turned about where the aim starts and is tilted by the aim's own angle.
  expect(effectPlaces(along, event(along))).toEqual(effectPlaces(breath(), event(breath())))
  const stand = aimStands(along, TALL)[1]!
  const place = effectPlaces(along, event(along), "owner", 7, stand)[0]!
  const pitch = aimPitch(UP, 0, stand)
  expect(place).toMatchObject({ forward: Number((0.4 * Math.cos(pitch)).toFixed(4)), up: Number((UP + 0.4 * Math.sin(pitch)).toFixed(4)), left: 0, turn: 0, spin: 0 })
  expect(place.pitch).toBeCloseTo((pitch * 180) / Math.PI, 2)
  // One that lies on the ground is put down and never tilted; its own turn is all it keeps.
  expect(grounded({ forward: 1, up: 2, left: 0, turn: 10, pitch: 6, spin: 30 })).toEqual({ forward: 1, up: 0, left: 0, turn: 40, pitch: 0, spin: 0 })
})

test("an effect put on a beam that aims goes along its aim without being told; a row keeps its length along the tilt", () => {
  const row = breath({}, { where: "hit", hit: 0, forward: -4, up: 0, count: 5, layout: "line", spread: 8 })
  expect(event(row).along).toBeUndefined()
  expect(eventFrame(row, event(row)).along).toBe("aim")
  const stand = aimStands(row, TALL)[1]!
  const at = effectAtHit(row, event(row), lookup(ID), row.hits[0]!.type === "area" ? row.hits[0]!.shape : null, stand)!
  // Five places from the start of the beam to eight blocks along it, each on its axis.
  expect(at.places.map((place) => Number(Math.hypot(place.forward, place.up - UP).toFixed(3)))).toEqual([0.5, 2.5, 4.5, 6.5, 8.5])
  expect(at.places.every((place) => Math.abs(Math.atan2(place.up - UP, place.forward) - aimPitch(UP, 0, stand)) < 1e-3)).toBe(true)
  // Written to stay level it is the creature's own terms again, from the middle of the hit.
  expect(eventFrame(row, { ...event(row), along: "facing" }).along).toBe("facing")
  // A ring in the tilted plane: each one turned outward about the tilted upright.
  const ring = breath({}, { where: "hit", hit: 0, forward: 0, up: 0, count: 4, layout: "ring", spread: 0.5 })
  expect(effectPlaces(ring, event(ring), "owner", 7, stand).map((place) => place.spin)).toEqual([0, 90, 180, 270])
  expect(effectPlaces(ring, event(ring)).map((place) => [place.turn, place.pitch, place.spin])).toEqual([[0, 0, 0], [90, 0, 0], [180, 0, 0], [270, 0, 0]])
})

test("a hit kept level stays level with what it shows, and says what it can reach", () => {
  const flat = breath({ aim: "level" })
  const shape = flat.hits[0]!.type === "area" ? flat.hits[0]!.shape : null
  expect(shapeAims(shape!)).toBe(false)
  expect(eventFrame(flat, { ...event(flat), hit: 0, along: "aim" })).toEqual({ along: "facing" })
  expect(effectAimGap(flat, event(flat), 0, lookup(ID), TALL)).toBeNull()
  expect(abilityEffectIssues({ name: "石像", abilities: [flat] }, lookup, TALL)).toEqual([])
  expect(abilityEffectLines(flat, lookup, TALL).join("")).toContain("第 1 次出手写的是水平打出去（aim: level）")
  expect(levelReach(flat, shape!)).toEqual({ distance: 7, low: 1.3, high: 2.5, reaches: true })
  // From above a player's head it reaches nobody who stands on the same ground, and that is said.
  const high = breath({ aim: "level", up: 3.35, radius: 1 })
  expect(levelReach(high, high.hits[0]!.type === "area" ? high.hits[0]!.shape : null!)).toMatchObject({ low: 2.35, high: 4.35, reaches: false })
  expect(hitLines(high, abilityHitShapes(high, fightingGolemDesign as never)![0]!)[0]).toContain("站在同一块地上的玩家（身高 1.8 格）不在这个高度里，打不中")
  // A beam that aims says nothing of the kind: its sentences are what they were.
  expect(hitLines(breath(), abilityHitShapes(breath(), fightingGolemDesign as never)![0]!).join("")).not.toContain("水平打出去")
})

test("the document says which way: old events and shapes read as before, and an aim is asked only of a hit that has one", () => {
  const wrong = (ability: Record<string, unknown>) => AbilitySchema.safeParse(ability).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  const plain = breath()
  expect(wrong({ ...plain, events: [{ ...event(plain), along: "aim" }] })).toContain('where 写 "hit" 或者 along 写 "aim" 的时候用 hit 写是第几次出手')
  expect(wrong({ ...plain, events: [{ ...event(plain), hit: 0 }] })).toContain("其余时候 hit 写 null")
  expect(wrong({ ...plain, events: [{ ...event(plain), hit: 0, along: "aim" }] })).toBe("")
  expect(wrong({ ...golemAbilities[0], events: [{ ...event(plain), hit: 0, along: "aim" }] })).toContain("它没有瞄的方向")
  expect(wrong({ ...plain, hits: [{ ...plain.hits[0], shape: { type: "sphere", forward: 1, up: 1, left: 0, radius: 1, aim: "level" } }] })).not.toBe("")
})

test("the generated creature tilts what it lays out along an aim, and checks a level beam against the way it faces", () => {
  // As it was for an effect in the creature's own terms and a beam that aims: not a character differs.
  const before = compiled(breath())
  expect(before).toContain(`abilityEffect("${ID}", abilityPoint(0.0, 0.0, 0.0), 0.4, 1.9, 0.0, 1, false, 0.0);`)
  expect(before).toContain("abilityInLine(victim, 1.9, 9.0, 0.6)")
  expect(before).not.toMatch(/abilityEffectAimed|abilityLevel/)
  // Along the aim: counted from where the aim starts (its own feet lie 1.9 below that point), the direction handed on.
  const along = compiled(breath({}, { hit: 0, along: "aim" }))
  expect(along).toContain(`abilityEffectAimed("${ID}", abilityPoint(0.0, 1.9, 0.0), abilityDirection(1.9, 0.0), 0.4, 0.0, 0.0, 1, false, 0.0);`)
  expect(along).toContain("Vec3 rise = aim.cross(side);")
  expect(along).toContain("StudioEffects.spawn(id, level(), at, abilityYaw, tilt, (float) Math.toDegrees(angle), this, abilityTarget);")
  // On the hit: the middle of the beam is half its length along the aim from the same point.
  expect(compiled(breath({}, { where: "hit", hit: 0, forward: 0, up: 0 }))).toContain(`abilityEffectAimed("${ID}", abilityPoint(0.0, 1.9, 0.0), abilityDirection(1.9, 0.0), 4.5, 0.0, 0.0, 1, false, 0.0);`)
  // Kept level: the beam is handed the level direction, and the effect is laid out as it always was.
  const flat = compiled(breath({ aim: "level" }))
  expect(flat).toContain("abilityInLine(victim, abilityLevel(), 1.9, 9.0, 0.6)")
  expect(flat).toContain("private boolean abilityInLine(LivingEntity victim, Vec3 aim, double up, double length, double radius) {")
  expect(flat).toContain("return new Vec3(-Mth.sin(turn), 0.0, Mth.cos(turn));")
  expect(flat).not.toContain("abilityEffectAimed")
})

test("the effect entity is told its tilt and its own turn exactly, and its renderer turns it in that order", () => {
  const made = compileEffects({ modId: "golem_mod", packageName: "com.minemods.content_golem_mod", effects: [{ id: ID, title: "气流", document: stream }] })
  const table = String(made.files["src/main/java/com/minemods/content_golem_mod/entity/StudioEffects.java"])
  const entity = String(made.files["src/main/java/com/minemods/content_golem_mod/entity/StudioEffect.java"])
  const renderer = String(made.files["src/main/java/com/minemods/content_golem_mod/client/StudioEffectRenderer.java"])
  // The call gameplay code and level layouts make is still there and means "not tilted".
  expect(table).toContain("return spawn(id, world, pos, yaw, 0.0f, 0.0f, owner, target);")
  expect(table).toContain("effect.begin(kind, owner, pos, turned, ON_GROUND[kind] || FACES_CAMERA[kind] ? 0.0f : tilt, faces || FACES_CAMERA[kind] ? 0.0f : spin);")
  expect(entity).toContain("EntityDataSerializers.VECTOR3")
  expect(entity).toContain("getEntityData().set(AIM, new Vector3f(yaw, tilt, spin));")
  expect(renderer.indexOf("Axis.YP.rotationDegrees(180.0f - yaw)")).toBeLessThan(renderer.indexOf("Axis.XP.rotationDegrees(effect.aim().y)"))
  expect(renderer.indexOf("Axis.XP.rotationDegrees(effect.aim().y)")).toBeLessThan(renderer.indexOf("Axis.YP.rotationDegrees(effect.aim().z)"))
})


test("what a reviewer is told of the generated class says which effects tilt with their hit and which hits are level, read back from the Java", () => {
  const read = (ability: Ability) => readGeneratedCreature(Object.values(compileAbilities({ entity: "StudioCreature", model: "creature", abilities: [ability], hostile: true, runtime: false, death: true })).join("\n"), null).abilities[0]!
  expect(read(breath())).toMatchObject({ effects: [{ tick: 20, effect: ID, count: 1, aimed: false }], level_hits: [] })
  expect(read(breath({}, { hit: 0, along: "aim" }))).toMatchObject({ effects: [{ tick: 20, effect: ID, count: 1, aimed: true }], level_hits: [] })
  expect(read(breath({ aim: "level" }))).toMatchObject({ effects: [{ aimed: false }], level_hits: [20] })
})

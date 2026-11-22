import { putModelAsset } from "../src/assets"
import { EntitySchema, createEntity, createProject, saveProject } from "../src/project"
import { HitboxSchema, type HitboxPart } from "../src/entity-runtime"
import type { TargetId } from "../src/target/ids"

const part = (name: string, forward: number, left: number, up: number, width: number, height: number, solid = true): HitboxPart =>
  ({ name, forward, left, up, width, height, solid })

const creatures = [
  { name: "碧苔龟", english: "Mossback Turtle", color: "#628b50", accent: "#b7c67c", parts: [
    part("苔壳", 0, 0, 0.15, 4, 1.35),
    part("头", 2.1, 0, 0.25, 0.9, 0.7, false),
    ...[-1, 1].flatMap((side) => [-1.1, 1.15].map((forward) => part("龟足 " + side + " " + forward, forward, side * 1.85, 0, 0.55, 0.48, false))),
  ] },
  { name: "石拱行者", english: "Stone Arch Walker", color: "#7c9daa", accent: "#c9b392", parts: [
    part("左柱", 0, 2.4, 0, 2, 3.8), part("右柱", 0, -2.4, 0, 2, 3.8),
    part("左拱肩", 0, 1.2, 3.4, 2.4, 0.8), part("右拱肩", 0, -1.2, 3.4, 2.4, 0.8),
    part("拱顶", 0, 0, 4.2, 2.1, 0.5), part("悬灯", 1.3, 0, 2.6, 0.45, 0.65, false),
  ] },
  { name: "巡山堡垒", english: "Ridge Fortress", color: "#a78269", accent: "#d6ac64", parts: [
    part("前桥", 2.4, 1.2, 0, 2.5, 2.4),
    ...[[-3.5, -3.5], [-3.5, 0], [-3.5, 3.5], [0, -3.5], [0, 0], [0, 3.5]].map(([forward, left], index) => part("外墙 " + (index + 1), forward!, left!, 0, 2.6, 2.6)),
    ...[-3.5, 0, 3.5].flatMap((forward) => [-3.5, 0, 3.5].map((left, index) => part("塔楼 " + forward + " " + index, forward, left, 2.6, 1.8, 1.8))),
  ] },
]

function design(creature: (typeof creatures)[number], documentLeft = false) {
  const flat = (color: string) => ({ north: color, south: color, east: color, west: color, up: color, down: color })
  const cubes = creature.parts.map((box, index) => ({
    name: "piece_" + index,
    origin: [((documentLeft ? box.left : -box.left) - box.width / 2) * 16, box.up * 16, (-box.forward - box.width / 2) * 16],
    size: [box.width, box.height, box.width].map((length) => Math.round(length * 16)),
    faces: { ...flat(box.solid === true ? creature.color : creature.accent), up: creature.accent },
  }))
  return {
    name: creature.name, budget: "fine", texture_size: 512,
    bones: [{ name: "body", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes }],
    animations: ["idle", "walk", "hurt"].map((name) => ({
      name, length: 1, loop: name !== "hurt",
      channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [0, 0, 0] }] }],
    })),
  }
}

// The rail stands clear of every damage box so a swing or arrow can test it in isolation.
const rail = { name: "外侧护栏", forward: 0, left: 7, up: 0, width: 2, height: 3 }

const steps = [-4, -2, 0, 2, 4]
const ring = steps.flatMap(forward => steps.filter(left => Math.max(Math.abs(left), Math.abs(forward)) === 4)
  .map(left => part(`墙 ${forward} ${left}`, forward, left, 0, 2, 1.5)))
const deck = part("中心台", 0, 0, 0, 6, 2)
const surfaceBodies = [
  { core: { width: 4, height: 1.5, solid: true } },
  { core: { width: 0.8, height: 1 }, blockers: [rail] },
  { core: { width: deck.width, height: deck.height, solid: true }, parts: ring, blockers: [rail], justified: [{ what: "out", reason: "外侧护栏只挡路，允许打空。" }] },
]
const surfaceModels = [creatures[0]!.parts, [part("支座", 0, 0, 0, 0.8, 1), { ...rail, solid: true }], [...ring, deck, { ...rail, solid: true }]]

export async function createTargetSolidBodySample(directory: string, target: TargetId, solid = true, surfaces = false) {
  const created = await createProject({ directory, name: "实心部位试场", description: "苔龟、拱门和巡山堡垒的身体碰撞。", mod_id: "solid_body_yard", target })
  const entities = creatures.map((creature, index) => EntitySchema.parse({
    ...createEntity({ name: creature.name, description: creature.name, behavior: "passive", health: 50, speed: 0.2, attack_damage: 0 }),
    name_en: creature.english,
    hitbox: HitboxSchema.parse(surfaces ? surfaceBodies[index] : { core: { width: 0.8, height: 1 }, parts: creature.parts.map(({ solid: enabled, ...box }) => ({ ...box, ...(solid && enabled ? { solid: true } : {}) })) }),
  }))
  let project = await saveProject(directory, { ...created, entities }, created.revision)
  for (const [index, entity] of entities.entries()) {
    project = (await putModelAsset(directory, { entity_id: entity.id, data: { design: design(surfaces ? { ...creatures[index]!, parts: surfaceModels[index]! } : creatures[index]!, surfaces) }, origin: "example", expectedRevision: project.revision })).project
  }
  return project
}

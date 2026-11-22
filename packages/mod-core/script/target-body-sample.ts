import path from "node:path"
import { putModelAsset } from "../src/assets"
import { EntitySchema, createEntity, createProject, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { giantDesign, giantHitbox } from "../test/giant-walker"
import { fightingGolemDesign, livingGolemDesign } from "./data-gameplay-sample"

/**
 * The body group of the platform layer (平台层-移植清单.md, C 组) in one project with a Chinese name, for Forge 1.20.1 and NeoForge 1.21.1:
 * - 「飞天石魔」: a flying boss (it hovers 3 to 8 blocks up, takes off and lands with motions of its own) with eyes of its own height and a box
 *   for its wings beside its body, which the lean of its flight carries.
 * - 「巢居兽」: a creature with habits: up by day and asleep at home by night, a home of 12 blocks, hunts chickens and eats them, and warns when a player comes near.
 * - 「六臂巨人」: the six-armed giant of the tests (`test/giant-walker.ts`): seven boxes that follow its hands and its head, a step of 2.5 blocks,
 *   and a way out when it is stuck (it may push straight on). It fights whoever it is set on (no player needed); no abilities (another group's port).
 *
 *   bun packages/mod-core/script/target-body-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
const clip = (name: string, length: number, loop: boolean) => ({ name, length, loop, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: length / 2, rotation: [-10, 0, 0] }, { time: length, rotation: [0, 0, 0] }] }] })

/** The golem with the motions of the air (and the boss's own wave kept out: it has no phases). */
const flierDesign = {
  ...fightingGolemDesign,
  animations: [...fightingGolemDesign.animations.filter((animation) => !["burst", "wave", "slam"].includes(animation.name)), clip("takeoff", 1, false), clip("fly", 1, true), clip("hover", 1, true), clip("land", 1, false)],
}
/** The golem with the motions of its habits. */
const dwellerDesign = { ...livingGolemDesign, animations: [...livingGolemDesign.animations.filter((animation) => !["wave", "roar"].includes(animation.name)), clip("sleep", 2, true), clip("eat", 1.5, false), clip("roar", 0.8, false)] }

export const BODY_SAMPLE = {
  flight: { style: "hover", speed: 6, altitude: { min: 3, max: 8 }, turn: 120, climb: 40, bank: 20, air_share: 0.5, takeoff: { clip: "takeoff", seconds: 1 }, land: { clip: "land", seconds: 1 }, clips: { fly: "fly", glide: null, hover: "hover" } },
  habits: { active: "day", rest: { clip: "sleep" }, home: { radius: 12 }, prey: ["chicken"], hunger_seconds: 30, eat: { clip: "eat" }, alert: { clip: "roar", distance: 8 } },
  /** The giant's step for this sample: two blocks are climbed without a jump (the test fixture's 1.5 would need one). */
  giantStep: 2.5,
} as const

export async function createTargetBodySample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "云端巨像", description: "飞天石魔在山口上空盘旋，巢居兽守着自己的窝，六臂巨人踏平一切。", mod_id: "sky_giants", target })
  const flier = EntitySchema.parse({
    ...createEntity({ name: "飞天石魔", description: "会飞的 Boss。", health: 150, speed: 0.25, attack_damage: 6, behavior: "hostile" }),
    name_en: "Sky Golem",
    runtime: { spawn: null, explosion: null, movement: "direct", armor: 4, charging_armor: 4, texture_asset_id: null },
    experience: 30,
    boss: { bar: { color: "blue", style: "progress", darken_sky: false }, intro: null, phases: [], death: { seconds: 2, xp_bursts: 2, explosion: false }, leash: null },
    flight: BODY_SAMPLE.flight,
    hitbox: { core: { width: 1.4, height: 2.6, eye_height: 2.2 }, parts: [{ name: "翼", forward: 0, up: 1.6, left: 1.2, width: 1, height: 0.5 }] },
  })
  const dweller = EntitySchema.parse({
    ...createEntity({ name: "巢居兽", description: "白天出来找鸡吃，晚上回窝睡觉。", health: 30, speed: 0.25, attack_damage: 3, behavior: "passive" }),
    name_en: "Den Dweller",
    habits: BODY_SAMPLE.habits,
  })
  const giant = EntitySchema.parse({
    ...createEntity({ name: "六臂巨人", description: "九格高的巨人，六只手跟着动作走。", health: 300, speed: 0.3, attack_damage: 10, behavior: "hostile" }),
    name_en: "Six-Armed Giant",
    hitbox: { ...giantHitbox, core: { ...giantHitbox.core, step: BODY_SAMPLE.giantStep } },
  })
  let project = await saveProject(directory, { ...created, entities: [flier, dweller, giant] }, created.revision)
  for (const [entity, design] of [[flier, flierDesign], [dweller, dwellerDesign], [giant, giantDesign]] as const)
    project = (await putModelAsset(directory, { entity_id: entity.id, data: { design }, origin: "example", expectedRevision: project.revision })).project
  return project
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-body-sample.ts <empty directory> [target]")
  const project = await createTargetBodySample(path.resolve(directory), target as TargetId)
  console.log(`Body project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}

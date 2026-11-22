import path from "node:path"
import { putModelAsset } from "../src/assets"
import { AbilitySchema, BossSchema, ComboSchema } from "../src/entity-runtime"
import { TacticsSchema } from "../src/ability-tactics"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign } from "./data-gameplay-sample"

/**
 * 第 3 步 (Boss AI 与出招) in one project with a Chinese name, for Fabric 1.21.1, Forge 1.20.1 and NeoForge 1.21.1, on the fighting golem's model (its motions
 * roar, wave, slam, burst and attack stand in for the stages' own):
 * - 「裂地将」, a boss that has all of it: 蓄力冲锋 (tracks until 0.55 s at 240° a second, a loop stage whose predicted dash ends when it strikes or meets a wall, then
 *   strike and recover with their own motions), 跳劈 (a leap that lands at its target on the tick of its slam), 横扫, 突刺 and the combo 收割 that branches by distance and by
 *   whether the thrust landed; it circles between attacks, closes in in its second phase, reacts to being kited (leap or charge) and hugged (it hops back), and is enraged below 30%.
 * - the creatures the headless check (`target-tactics-check.ts`) watches one at a time: 「跳劈将」 (only the leap), 「冲锋将」 (only the predicted charge), 「对照将」 (the
 *   same charge aimed where the target is when it starts) and 「连招将」 (the branching combo, its steps weighted far below it).
 * - 「短跳将」 (a leap that lands 3 blocks short of its target, which the check puts on a pillar: it comes down on the ground there, not at their height) and 「蓄势将」
 *   (a loop that ends when its target is near, then a slam whose warning begins inside the loop: the warning and the slam still happen).
 * - 「狂怒将」 and 「狂奔将」: an enrage with no style between abilities, on the abilities' own chase and on a runtime's movement (compiled; the check does not watch them).
 *
 *   bun packages/mod-core/script/target-tactics-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
export const charge = AbilitySchema.parse({
  id: "charge",
  name: "蓄力冲锋",
  clip: "roar",
  windup: 0.6,
  length: 3,
  facing: "track",
  track_until: 0.55,
  turn_speed: 240,
  stages: [
    { kind: "windup", until: 0.6 },
    { kind: "loop", until: 2.2, clip: "burst", end: { landed: true, wall: true } },
    { kind: "strike", until: 2.5, clip: "slam" },
    { kind: "recover", until: 3, clip: "wave" },
  ],
  hits: [
    { type: "area", at: 0.6, shape: { type: "box", forward: 1, up: 1, left: 0, width: 2, height: 2.5, depth: 2 }, hits: "everyone", damage: 6, knockback: 0.5, effects: [] },
    { type: "area", at: 2.25, shape: { type: "arc", reach: 3.5, angle: 120, low: -0.5, high: 3 }, hits: "everyone", damage: 5, knockback: 0.8, effects: [] },
  ],
  moves: [{ type: "dash", from: 0.6, to: 2.2, speed: 15, distance: 22, aim: "predicted", stop_at_wall: true, hit: 0 }],
  start: { min_distance: 6, max_distance: 24, line_of_sight: false, cooldown: 6, weight: 3 },
  stopped_by_hurt: false,
  events: [{ type: "sound", at: 0.6, sound: "entity.ravager.roar", volume: 1, pitch: 1 }],
})

/** The same charge aimed where its target stands when it starts, the control the check measures the lead against. */
export const lockedCharge = AbilitySchema.parse({ ...charge, moves: [{ ...charge.moves[0]!, aim: "locked_at_windup" }] })

export const leapSlam = AbilitySchema.parse({
  id: "leap_slam",
  name: "跳劈",
  clip: "slam",
  windup: 0.3,
  length: 1.2,
  facing: "track",
  hits: [{ type: "area", at: 1, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 3 }, hits: "everyone", damage: 8, knockback: 0.6, effects: [] }],
  moves: [{ type: "leap", at: 0.3, land: 1, height: 3, aim: "target", max_distance: 16 }],
  start: { min_distance: 4, max_distance: 16, line_of_sight: false, cooldown: 5, weight: 2 },
  stopped_by_hurt: false,
  events: [{ type: "shake", at: 1, strength: 1.5, radius: 12, seconds: 0.5 }],
})

/** The leap that comes down 3 blocks short of its target: where it lands need not be as high as where they stand (the check puts them on a pillar). */
export const shortLeap = AbilitySchema.parse({ ...leapSlam, id: "short_leap", name: "短跳劈", moves: [{ ...leapSlam.moves[0]!, short: 3 }] })

/**
 * 蓄势砸地: a loop (0.6 to 2.2 s) that ends as soon as its target is within 3 blocks, then a slam at 2.25 s warned of 0.5 s before, so its warning begins at 1.75 s, inside the loop.
 * The loop that ends early still begins that warning (and decides where the slam lands) before the slam; the roar at 1.9 s is the rest of the loop and does not happen.
 */
export const gatherSlam = AbilitySchema.parse({
  id: "gather_slam",
  name: "蓄势砸地",
  clip: "roar",
  windup: 0.6,
  length: 3,
  facing: "track",
  stages: [
    { kind: "windup", until: 0.6 },
    { kind: "loop", until: 2.2, clip: "burst", end: { reach: 3 } },
    { kind: "strike", until: 2.5, clip: "slam" },
    { kind: "recover", until: 3, clip: "wave" },
  ],
  hits: [{ type: "area", at: 2.25, shape: { type: "sphere", forward: 1, up: 0, left: 0, radius: 2.5 }, hits: "everyone", damage: 6, knockback: 0.5, effects: [], warn: { seconds: 0.5, look: "ring", color: "red" } }],
  moves: [],
  start: { min_distance: 0, max_distance: 12, line_of_sight: false, cooldown: 6, weight: 1 },
  stopped_by_hurt: false,
  events: [{ type: "sound", at: 1.9, sound: "entity.ravager.roar", volume: 1, pitch: 1 }],
})

export const sweep = AbilitySchema.parse({
  id: "sweep",
  name: "横扫",
  clip: "attack",
  windup: 0.25,
  length: 0.5,
  facing: "track",
  hits: [{ type: "area", at: 0.35, shape: { type: "arc", reach: 3.5, angle: 160, low: -0.5, high: 3 }, hits: "everyone", damage: 4, knockback: 0, effects: [] }],
  moves: [],
  start: { min_distance: 0, max_distance: 3.5, line_of_sight: false, cooldown: 4, weight: 1 },
  stopped_by_hurt: false,
  events: [],
})

export const thrust = AbilitySchema.parse({
  id: "thrust",
  name: "突刺",
  clip: "burst",
  windup: 0.3,
  length: 0.9,
  facing: "track",
  hits: [{ type: "area", at: 0.4, shape: { type: "box", forward: 2, up: 1, left: 0, width: 1.5, height: 2, depth: 3 }, hits: "everyone", damage: 5, knockback: 0, effects: [] }],
  moves: [],
  start: { min_distance: 0, max_distance: 3.5, line_of_sight: false, cooldown: 4, weight: 1 },
  stopped_by_hurt: false,
  events: [],
})

/** 收割: the sweep, then the leap when its target has got 4 blocks or more away, the thrust while it is nearer; the thrust that has struck nobody by 0.6 s ends it. */
export const reaper = ComboSchema.parse({
  id: "reaper",
  name: "收割",
  steps: ["sweep", "leap_slam", "thrust"],
  gap_ticks: 2,
  damage_scale: 1,
  start: { min_distance: 0, max_distance: 3.5, line_of_sight: false, cooldown: 3, weight: 100 },
  branches: [
    { after: 0, min_distance: 4, to: 1 },
    { after: 0, max_distance: 4, to: 2 },
    { after: 1, to: null },
    { after: 2, at: 0.6, landed: false, to: null },
  ],
})

export const tactics = TacticsSchema.parse({
  between: { style: "circle", distance: 5, pause: 0.5 },
  kited: { distance: 12, seconds: 3, use: ["leap_slam", "charge"] },
  hugged: { distance: 1.5, seconds: 2 },
  enrage: { below: 0.3, speed: 1.3, damage: 1.5, cooldown: 0.6 },
})

export const bossOfAll = BossSchema.parse({
  bar: { color: "red", style: "notched_10", darken_sky: false },
  intro: null,
  phases: [{ below: 0.5, clip: "roar", seconds: 1, bar_color: "purple", speed: 1.2, damage: 1.2, between: { style: "close_in", distance: 3, pause: 0.2 } }],
  death: { seconds: 2, xp_bursts: 2, explosion: false },
  leash: null,
})

const creature = (name: string, name_en: string, description: string, more: Record<string, unknown>) =>
  EntitySchema.parse({ ...createEntity({ name, description, health: 300, speed: 0.25, attack_damage: 6, behavior: "hostile" }), name_en, ...more })

export async function createTargetTacticsSample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "裂地关", description: "裂地将跳劈、冲锋、连招。", mod_id: "rift_general", target })
  const entities = [
    creature("裂地将", "Rift General", "会跳劈、会冲锋、会连招的大将。", { abilities: [charge, leapSlam, sweep, thrust], combos: [reaper], tactics, boss: bossOfAll }),
    creature("跳劈将", "Leaper", "只会跳劈。", { abilities: [leapSlam] }),
    creature("冲锋将", "Charger", "只会预判冲锋。", { abilities: [charge] }),
    creature("对照将", "Locked Charger", "冲锋方向在开始时定下。", { abilities: [lockedCharge] }),
    creature("连招将", "Reaper", "只会收割连招。", { abilities: [sweep, leapSlam, thrust], combos: [reaper] }),
    // Only an enrage, no style between abilities: its plain chase (the abilities' own goal, and a runtime's movement) is what the enrage speeds up.
    creature("短跳将", "Short Leaper", "跳到目标前 3 格落下。", { abilities: [shortLeap] }),
    creature("蓄势将", "Gatherer", "循环逼近，近了就收住，预警后砸地。", { abilities: [gatherSlam] }),
    creature("狂怒将", "Enraged", "血少了追得更快。", { abilities: [sweep], tactics: { enrage: tactics.enrage } }),
    creature("狂奔将", "Enraged Runner", "按自己的冲刺节奏追，血少了更快。", { abilities: [sweep], tactics: { enrage: tactics.enrage }, runtime: { spawn: null, explosion: null, movement: "burst", armor: 0, charging_armor: 0, texture_asset_id: null } }),
  ]
  let project = await saveProject(directory, { ...created, entities }, created.revision)
  for (const entity of entities) project = (await putModelAsset(directory, { entity_id: entity.id, data: { design: fightingGolemDesign }, origin: "example", expectedRevision: project.revision })).project
  return project
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-tactics-sample.ts <empty directory> [target]")
  const project = await createTargetTacticsSample(path.resolve(directory), target as TargetId)
  console.log(`Tactics project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}

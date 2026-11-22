import path from "node:path"
import { putModelAsset } from "../src/assets"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign } from "./data-gameplay-sample"
import { sweep, thrust } from "./target-tactics-sample"

/**
 * What every boss of a big boss mod has (`boss-base.ts`) in one project with a Chinese name, for Fabric 1.21.1, Forge 1.20.1 and NeoForge 1.21.1, on the fighting golem's model:
 * - 「铁壁将」, 600 life, all four: one blow takes at most 40, any 5 seconds at most 120, 10 a second back after 3 quiet seconds with nobody to fight, and half again its life
 *   and a fifth more damage for each player more than one within 16 blocks (4 counted at most). It fights from the start, has two abilities of the tactics sample, 横扫 and 突刺 (their damage is
 *   multiplied too), one phase at half its life, and a leash of 120 seconds. The headless check (`target-boss-base-check.ts`) watches it.
 * - 「沉眠铁壁」, 300 life: a wake-up, only a cap on one blow and its life coming back in the fight as well (after 2 quiet seconds), no window and no scaling: the other ways
 *   the pieces are written, compiled beside the first.
 *
 *   bun packages/mod-core/script/target-boss-base-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
export const ironWallBase = {
  damage_cap: 40,
  dps_cap: { amount: 120, seconds: 5 },
  regen: { per_second: 10, after_seconds_without_damage: 3, in_fight: false },
  scaling: { per_extra_player: { health: 0.5, damage: 0.2 }, radius: 16, max_players: 4 },
}

const abilities = [sweep, thrust]

export const ironWall = (more: Record<string, unknown> = {}) =>
  EntitySchema.parse({
    ...createEntity({ name: "铁壁将", description: "打不穿的铁壁，人越多越硬。", health: 600, speed: 0.25, attack_damage: 6, behavior: "hostile" }),
    name_en: "Iron Wall",
    abilities,
    boss: {
      bar: { color: "white", style: "notched_10", darken_sky: false },
      intro: null,
      phases: [{ below: 0.5, clip: "wave", seconds: 1, bar_color: "red", speed: 1.1, damage: 1.2 }],
      death: { seconds: 2, xp_bursts: 0, explosion: false },
      leash: { distance: 48, reset_seconds: 120 },
      ...ironWallBase,
    },
    ...more,
  })

export const sleepingWall = () =>
  EntitySchema.parse({
    ...createEntity({ name: "沉眠铁壁", description: "睡着的铁壁，醒了一下最多掉 25 血，打着也回血。", health: 300, speed: 0.25, attack_damage: 5, behavior: "hostile" }),
    name_en: "Sleeping Wall",
    boss: {
      bar: { color: "blue", style: "progress", darken_sky: true },
      intro: { wake_distance: 12, clip: "roar", seconds: 1, sound: null },
      phases: [],
      death: { seconds: 2, xp_bursts: 2, explosion: false },
      leash: null,
      damage_cap: 25,
      regen: { per_second: 2, after_seconds_without_damage: 2, in_fight: true },
    },
  })

export async function createTargetBossBaseSample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "铁壁关", description: "铁壁将守关：一下打不穿，几秒里打不穿，人越多越硬。", mod_id: "iron_wall", target })
  const entities = [ironWall(), sleepingWall()]
  let project = await saveProject(directory, { ...created, entities }, created.revision)
  for (const entity of entities) project = (await putModelAsset(directory, { entity_id: entity.id, data: { design: fightingGolemDesign }, origin: "example", expectedRevision: project.revision })).project
  return project
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-boss-base-sample.ts <empty directory> [target]")
  const project = await createTargetBossBaseSample(path.resolve(directory), target as TargetId)
  console.log(`Boss base project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}

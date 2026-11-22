import path from "node:path"
import { putModelAsset } from "../src/assets"
import { BossBarDocumentSchema } from "../src/boss-bar"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { WorkspaceAssetSchema } from "../src/workspace"
import { livingGolemDesign } from "./data-gameplay-sample"

/**
 * The boss group of the platform layer (平台层-移植清单.md, B 组) in one project with a Chinese name, for Forge 1.20.1 and NeoForge 1.21.1:
 * - 「守关石魔」: a boss that fights from the start, a bar with a darkened sky, two phases (at 66% and 33% of its life, each with its motion,
 *   faster and harder, the first with another bar colour), a death of 3 seconds played out in 4 bursts of experience and a blast of light
 *   and sound, a leash of 120 seconds, and a lair (a platform of packed ice and blue ice with a rim of snow, the boss placed in it once).
 * - 「沉睡石魔」: a boss with a wake-up (it sleeps until somebody comes within 12 blocks, then roars for a second) and no phases.
 * - 「巡山石魔」: a boss whose leash ends a fight after 5 seconds with nobody near: full health again.
 * None has abilities (another group's port): the screen shake and the pieces of the ground are written by `target-boss-check.ts` beside them.
 *
 *   bun packages/mod-core/script/target-boss-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
export async function createTargetBossSample(directory: string, target: TargetId, options: { bar?: boolean } = {}) {
  const created = await createProject({ directory, name: "石魔山口", description: "守关石魔守着山口，沉睡石魔在巢里等人。", mod_id: "stone_pass", target })
  const golem = (name: string, name_en: string, boss: Record<string, unknown>) =>
    EntitySchema.parse({
      ...createEntity({ name, description: `${name}，山口的 Boss。`, health: 200, speed: 0.22, attack_damage: 8, behavior: "hostile" }),
      name_en,
      runtime: { spawn: null, explosion: null, movement: "direct", armor: 6, charging_armor: 6, texture_asset_id: null },
      experience: 40,
      boss,
    })
  const keeper = golem("守关石魔", "Pass Keeper", {
    bar: { color: "purple", style: "notched_10", darken_sky: true },
    intro: null,
    phases: [
      { below: 0.66, clip: "wave", seconds: 1, bar_color: "red", speed: 1.15, damage: 1.3 },
      { below: 0.33, clip: "wave", seconds: 1, bar_color: null, speed: 1.3, damage: 1.6 },
    ],
    death: { seconds: 3, xp_bursts: 4, explosion: true },
    leash: { distance: 48, reset_seconds: 120 },
    lair: { biomes: ["minecraft:plains"], tags: ["is_mountain"], spacing: 40, radius: 8, floor: ["minecraft:packed_ice", "minecraft:blue_ice"], rim: "minecraft:snow_block", clearance: 8 },
  })
  const sleeper = golem("沉睡石魔", "Sleeping Golem", {
    bar: { color: "blue", style: "progress", darken_sky: false },
    intro: { wake_distance: 12, clip: "roar", seconds: 1, sound: "entity.iron_golem.attack" },
    phases: [],
    death: { seconds: 2, xp_bursts: 0, explosion: false },
    leash: null,
  })
  const ranger = golem("巡山石魔", "Ridge Ranger", {
    bar: { color: "green", style: "notched_6", darken_sky: false },
    intro: null,
    phases: [{ below: 0.5, clip: null, seconds: 0.5, bar_color: "yellow", speed: 1, damage: 1 }],
    death: { seconds: 1, xp_bursts: 2, explosion: false },
    leash: { distance: 16, reset_seconds: 5 },
  })
  let project = await saveProject(directory, { ...created, entities: [keeper, sleeper, ranger] }, created.revision)
  for (const entity of [keeper, sleeper, ranger]) project = (await putModelAsset(directory, { entity_id: entity.id, data: { design: livingGolemDesign }, origin: "example", expectedRevision: project.revision })).project
  if (!options.bar) return project
  // B2 (a boss's own bar): the keeper shows the bronze plaque, a stage's name for each of its three stages; no icons, since the sample has no abilities.
  const now = new Date().toISOString()
  const bar = { id: BOSS_BAR_SAMPLE_ID, module: "bossbar", title: "山口铜牌", revision: 1, created_at: now, updated_at: now, prompt: "朴素的青铜牌", dependencies: [], document: bossBarSample, provenance: { model: null, request_id: null }, status: "ready" }
  const look = { ...(keeper.boss as { bar: Record<string, unknown> }).bar, look: { asset: BOSS_BAR_SAMPLE_ID } }
  return saveProject(
    directory,
    {
      ...project,
      entities: project.entities.map((entity) => (entity.id === keeper.id ? { ...entity, boss: { ...entity.boss!, bar: look as never } } : entity)),
      workspace: {
        assets: [
          ...project.workspace.assets.map((asset) => (asset.document.kind === "entity" && asset.document.model_asset_id === keeper.id ? { ...asset, dependencies: [...asset.dependencies, BOSS_BAR_SAMPLE_ID], document: { ...asset.document, boss: { ...asset.document.boss!, bar: look as never } } } : asset)),
          WorkspaceAssetSchema.parse(bar),
        ],
      },
    },
    project.revision,
  )
}

/** The keeper's own bar (`createTargetBossSample(…, { bar: true })`): the bronze plaque, three stages. */
export const BOSS_BAR_SAMPLE_ID = "b0551ba7-0000-4000-8000-000000000001"
export const bossBarSample = BossBarDocumentSchema.parse({ kind: "bossbar", background: "bronze", fill: null, drain: "left", segments: [], lock: { frames: null, ticks: 4, at: [] }, icons: [], names: [{ zh: "守关", en: "Guarding" }, { zh: "震怒", en: "Wrath" }, { zh: "死守", en: "Last Stand" }], name_at: null, dots: null })

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-boss-sample.ts <empty directory> [target]")
  const project = await createTargetBossSample(path.resolve(directory), target as TargetId)
  console.log(`Boss project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}

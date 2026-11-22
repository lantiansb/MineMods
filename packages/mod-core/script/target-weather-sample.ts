import path from "node:path"
import { putModelAsset } from "../src/assets"
import { AbilitySchema } from "../src/entity-runtime"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign } from "./data-gameplay-sample"

/**
 * Boss 能力 7 (天气、天色和落雷) in one project with a Chinese name, for every target:
 * - 「雷公」: a boss that fights from the start. Its first phase change (at 66% of its life) brings a thunderstorm and a sky 60% dark to the players of its fight;
 *   the second (at 33%) a plain rain and 30% dark; its leash ends a fight after 5 seconds with nobody within the battle range.
 * - with `lightning`: its one ability 「引雷」 plays `burst`: a bolt on the feet of the one it fights, warned 0.8 s before by a yellow pillar; two unwarned bolts in a pattern
 *   ahead of it; and a bolt on its own feet (which must hurt neither it nor its own kind). The ability's one hit does nothing to anybody, so all the damage is the lightning's.
 *
 *   bun packages/mod-core/script/target-weather-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1] [lightning]
 */
export const STORM_WEATHER = { rain: true, thunder: true, dark: 0.6 } as const
export const RAIN_WEATHER = { rain: true, thunder: false, dark: 0.3 } as const

export const stormAbility = AbilitySchema.parse({
  id: "call_lightning",
  name: "引雷",
  clip: "burst",
  windup: 0.8,
  length: 1.6,
  facing: "lock",
  hits: [{ type: "area", at: 1, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 0.5 }, hits: "target", damage: 0, knockback: 0, effects: [] }],
  moves: [],
  start: { min_distance: 0, max_distance: 24, line_of_sight: false, cooldown: 1, weight: 1 },
  stopped_by_hurt: false,
  events: [
    { type: "lightning", at: 1.2, place: "target", warn: { seconds: 0.8, look: "pillar", color: "yellow" }, damage: 6, radius: 2 },
    { type: "lightning", at: 1.3, place: { type: "pattern", points: [{ forward: 3, left: 2 }, { forward: 3, left: -2 }] }, damage: 4, radius: 1.5 },
    { type: "lightning", at: 1.4, place: "self", damage: 50, radius: 2.5 },
    { type: "sound", at: 1.2, sound: "entity.iron_golem.attack", volume: 1, pitch: 0.6 },
  ],
})

export async function createTargetWeatherSample(directory: string, target: TargetId, options: { lightning?: boolean } = {}) {
  const created = await createProject({ directory, name: "雷泽", description: "雷公守着雷泽：变身的时候只有和它打的人头上下起雷雨。", mod_id: "thunder_marsh", target })
  const lord = EntitySchema.parse({
    ...createEntity({ name: "雷公", description: "雷泽的 Boss，变身时召来雷雨。", health: 300, speed: 0.22, attack_damage: 8, behavior: "hostile" }),
    name_en: "Thunder Lord",
    runtime: { spawn: null, explosion: null, movement: "direct", armor: 4, charging_armor: 4, texture_asset_id: null },
    // It picks the nearest player by itself, and fights whoever else it is given as its target (the lightning check gives it an iron golem).
    engagement: "any_player",
    experience: 40,
    boss: {
      bar: { color: "blue", style: "notched_10", darken_sky: false },
      intro: null,
      phases: [
        { below: 0.66, clip: "roar", seconds: 0.8, bar_color: "purple", speed: 1.1, damage: 1.2, weather: STORM_WEATHER },
        { below: 0.33, clip: null, seconds: 0.5, bar_color: "red", speed: 1.2, damage: 1.4, weather: RAIN_WEATHER },
      ],
      death: { seconds: 2, xp_bursts: 2, explosion: false },
      leash: { distance: 32, reset_seconds: 5 },
    },
    ...(options.lightning ? { abilities: [stormAbility] } : {}),
  })
  const project = await saveProject(directory, { ...created, entities: [lord] }, created.revision)
  return (await putModelAsset(directory, { entity_id: lord.id, data: { design: fightingGolemDesign }, origin: "example", expectedRevision: project.revision })).project
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1", lightning] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-weather-sample.ts <empty directory> [target] [lightning]")
  const project = await createTargetWeatherSample(path.resolve(directory), target as TargetId, { lightning: lightning === "lightning" })
  console.log(`Weather project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}

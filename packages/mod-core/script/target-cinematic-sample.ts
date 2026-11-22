import { AbilitySchema, EntitySchema } from "../src/entity-runtime"
import { saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { createTargetArenaSample, ARENA_SAMPLE_IDS } from "./target-arena-sample"

export const cameraCue = { radius: 32, fov: 0.5, rise: 0.6, hold: 0.8, fade: 0.6, easing: "smooth" as const }
export const skyCue = { radius: 32, color: "#ff3030", strength: 0.85, hold: 0.8, fade: 1, edge: true }
export const cinematicAbility = AbilitySchema.parse({
  id: "cinematic", name: "赤天震地", clip: "zhuolu", windup: 0.4, length: 9, facing: "lock",
  hits: [
    { type: "area", at: 3, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 3 }, hits: "everyone", damage: 0, knockback: 0, effects: [] },
    { type: "projectile", at: 6.5, look: { effect: ARENA_SAMPLE_IDS.spike }, from: { sky: { over: "self", height: 6 } }, speed: 0.7, gravity: 0.04, path: "straight", damage: 0, knockback: 0, effects: [], radius: 0, impact: { camera: { ...cameraCue, fov: 1.3, rise: 0.2, hold: 0.3, fade: 0.4 }, sky_tint: { ...skyCue, hold: 0.3, fade: 0.4, edge: false } } },
  ],
  moves: [], start: { min_distance: 0, max_distance: 32, line_of_sight: false, cooldown: 60, weight: 1 }, stopped_by_hurt: false,
  events: [
    { type: "camera", at: 0.5, ...cameraCue },
    { type: "sky_tint", at: 3, ...skyCue },
    { type: "shake", at: 3, strength: 0.5, radius: 32, seconds: 0.5, roll: 1, fov: 2 },
    { type: "debris", at: 5, where: "self", hit: null, forward: 0, up: 0, left: 0, radius: 3, count: 24, throw: { speed: 0.65, spread: 0.12, gravity: 0.04 } },
  ],
})

export async function createTargetCinematicSample(directory: string, target: TargetId) {
  const project = await createTargetArenaSample(directory, target)
  return saveProject(directory, {
    ...project,
    entities: project.entities.map(entity => EntitySchema.parse({ ...entity, name: "赤天巨像", abilities: [cinematicAbility], boss: { ...entity.boss!, arena: null, phases: [{ below: 0.5, clip: null, seconds: 0.5, bar_color: "red", speed: 1, damage: 1, abilities: [], weather: { rain: false, thunder: false, dark: 0.25 } }] } })),
  }, project.revision)
}

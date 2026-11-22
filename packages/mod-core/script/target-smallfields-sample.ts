import path from "node:path"
import { AbilitySchema, EntitySchema } from "../src/entity-runtime"
import { randomUUID } from "node:crypto"
import { ItemSchema, BlockSchema } from "../src/content"
import { WorkspaceAssetSchema } from "../src/workspace"
import { saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { golemEffects } from "./data-gameplay-sample"
import { createTargetGroundFxSample } from "./target-groundfx-sample"

export async function createTargetSmallFieldsSample(directory: string, target: TargetId) {
  const project = await createTargetGroundFxSample(directory, target)
  const [guardian, ...others] = project.entities
  const art = WorkspaceAssetSchema.parse({ ...project.workspace.assets.find(a => a.document.kind === "effect"), id: randomUUID(), title: "地面风纹", document: golemEffects.mark.document })
  const abilities = guardian!.abilities!.map(ability => AbilitySchema.parse({
    ...ability,
    moves: ability.id === "ray" ? [{ type: "dash", from: 0.5, to: 1.5, speed: 12, distance: 10, aim: "locked_at_windup", hit: null, stop_at_wall: true, break_hardness: 2 }] : ability.moves,
    hits: ability.hits.map(hit => hit.type === "area" ? { ...hit, blocked_by_walls: true, ...(ability.id === "scorch" ? { warn: { seconds: 0.7, look: "ring", color: "purple", follow: "caster", fade_seconds: 0.6, effect: art.id } } : {}) } : hit),
    events: [...(ability.id === "scorch" ? [{ type: "sound", at: 0, sound: "entity.arrow.shoot", volume: 0.65, pitch: 0.7, pitch_to: 1.4 }] : []), ...ability.events.map(event => event.type === "shockwave" ? { ...event, hit_height: 0.35, height: 0.35 } : event.type === "hazard" ? { ...event, shape: "square", growth: { per_second: 1, per_hit: 0.25, max_radius: 7 } } : event)],
  }))
  const phase = guardian!.boss!.phases[0]!
  const boss = { ...guardian!.boss, phases: [
    { ...phase, below: 0.7, sound: "entity.iron_golem.attack" },
    { ...phase, below: 0.3, sound: "entity.player.attack.crit" },
  ] }
  const changed = EntitySchema.parse({ ...guardian, abilities, boss, tactics: { between: {
    style: "circle", distance: 6, pause: 1, side_ticks: 160, path_ticks: 12, stand_distance: 2,
    mix: { every_ticks: 40, choices: [{ style: "circle", weight: 3 }, { style: "close_in", weight: 1 }] },
  } } })
  const homing = { strength: 0.3, range: 24 }
  const item = ItemSchema.parse({ id: randomUUID(), identifier: "reed_staff", name: "风苇杖", name_en: "Reed Staff", max_stack: 1, color: "#82AE76" })
  const now = new Date().toISOString()
  const skill = WorkspaceAssetSchema.parse({
    id: randomUUID(), module: "ability", title: "回风箭", revision: 1, created_at: now, updated_at: now, prompt: "回风箭", dependencies: [],
    provenance: { model: "example", request_id: null }, status: "ready", document: {
      kind: "ability", name: "回风箭", english_name: "Wind Arrow", cast: { type: "charge", seconds: 1.2, cooldown: 2, release: { min_seconds: 0.2 } },
      sounds: { loop: "entity.arrow.shoot" }, loop_pitch: { from: 0.7, to: 1.4 }, reach: 24,
      hits: [{ type: "shot", at: 0, projectile: "arrow", speed: 1.2, forward: 0.5, up: 1.3, damage: 5, homing }, { type: "area", at: 0, shape: { type: "sphere", forward: 0, up: 0.5, left: 0, radius: 2 }, hits: "everyone", damage: 2, knockback: 0, effects: [], place: "target", warn: { seconds: 1.2, look: "ring", color: "purple", follow: "target", fade_seconds: 0.3 } }],
      moves: [], events: [], bindings: [{ type: "item", item: "reed_staff", use: "hold" }],
    },
  })
  const tile = BlockSchema.parse({ id: randomUUID(), identifier: "frost_tile", name: "霜纹地砖", name_en: "Frost Tile", hardness: 1.5, luminance: 2, tool: "pickaxe", drop: "self", color: "#719fba" })
  const trap = WorkspaceAssetSchema.parse({ ...skill, id: randomUUID(), dependencies: [art.id], title: "霜纹陷阱", prompt: "触碰后先显出霜纹，再铺开冰雾", document: {
    kind: "ability", name: "霜纹陷阱", english_name: "Frost Trap", cast: { type: "instant", seconds: 0, cooldown: 5 }, reach: 6,
    hits: [{ type: "area", at: 1, place: "self", shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 2 }, hits: "everyone", damage: 1, knockback: 0, effects: [], warn: { seconds: 1, look: "ring", color: "purple", fade_seconds: 0.4, effect: art.id } }],
    events: [{ type: "sound", at: 0, sound: "entity.arrow.shoot", volume: 1, pitch: 0.9, pitch_variation: 0.1 }, { type: "hazard", at: 1, where: "self", forward: 0, left: 0, radius: 2, shape: "square", growth: { per_second: 1, per_hit: 0.25, max_radius: 5 }, seconds: 4, color: "#80c8ed", glow: true, damage: 2, hits: "everyone", effects: [], every_ticks: 10, particle: "snowflake", count: 5 }],
    moves: [], bindings: [{ type: "block", block: "frost_tile" }],
  } })
  const shooter = EntitySchema.parse({ ...others[0], abilities: others[0]!.abilities!.map(ability => ({
    ...ability, hits: ability.hits.map(hit => hit.type === "projectile" ? {
      ...hit, from: { bone: "head" }, warn: undefined, gravity: 0, lifetime_ticks: 40, pierce: 2, bounces: 1, homing, count: 1, spread: undefined,
    } : hit),
  })) })
  return saveProject(directory, { ...project, entities: [changed, shooter], items: [...project.items, item], blocks: [...project.blocks, tile], workspace: { assets: [...project.workspace.assets, art, skill, trap] } }, project.revision)
}

if (import.meta.main) {
  const [directory, target] = process.argv.slice(2)
  if (!directory || !target) throw new Error("Usage: target-smallfields-sample.ts <directory> <target>")
  await createTargetSmallFieldsSample(path.resolve(directory), target as TargetId)
}

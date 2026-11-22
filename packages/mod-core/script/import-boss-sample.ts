import path from "node:path"
import { randomUUID } from "node:crypto"
import { abilityExamples } from "../src/ability-examples"
import { putModelAsset } from "../src/assets"
import { createEntity, createProject, ProjectSchema, saveProject } from "../src/project"
import { EntitySchema } from "../src/entity-runtime"
import { FixtureDocumentSchema } from "../src/fixture"
import { ParticleDocumentSchema } from "../src/particle"
import { encodePng } from "../src/png"
import type { SoundDocument } from "../src/sound"
import type { TargetId } from "../src/target/ids"
import { applyContent, WorkspaceAssetSchema } from "../src/workspace"
import { ContentSchema } from "../src/content"
import { oggDataUrl, oggVorbis } from "../test/ogg-sample"
import { fightingGolemDesign, golemAbilities, golemEffects } from "./data-gameplay-sample"

/**
 * One small project with one boss of its own, made as Studio saves one, for 从别的工程导入 (`src/project-import.ts`): its own model and motions, two abilities
 * and a shared ability (技能资产) that shows an effect, a particle and a sound of its own, an arena fixture, a drop of its own (「核心」) with the recipe that makes it,
 * and a summoning token made from the drop. Three themes; on purpose every one names its drop 「核心」 (`core`), its token `token`, its particle `spark`, its sound
 * `roar` and its fixture 「石柱」, and all share the same spike effect: what a merge has to rename, or may use once.
 *
 *   bun packages/mod-core/script/import-boss-sample.ts <empty directory> <frost|lava|thorn> [target]
 */
export const IMPORT_THEMES = {
  frost: { project: "霜原", mod_id: "frost_plain", boss: "霜甲巨像", boss_en: "Frost Colossus", color: "#7FC8F0", dark: "#2E5E7E", spark: "#BFF4FF", ore: "minecraft:ice", pitch: 1.2, samples: 22050 },
  lava: { project: "火山口", mod_id: "crater", boss: "熔岩魔像", boss_en: "Magma Golem", color: "#E0602A", dark: "#5A1E0E", spark: "#FFB347", ore: "minecraft:magma_block", pitch: 0.7, samples: 26460 },
  thorn: { project: "荆棘林", mod_id: "thorn_wood", boss: "荆棘树人", boss_en: "Thorn Treant", color: "#5E9E3A", dark: "#2F3E1A", spark: "#C8F07A", ore: "minecraft:oak_log", pitch: 1, samples: 30870 },
} as const
export type ImportTheme = keyof typeof IMPORT_THEMES

const recolor = <T>(value: T, color: string, dark: string): T => JSON.parse(JSON.stringify(value).replace(/"#[0-9A-Fa-f]{6}"/g, (found, offset: number) => (offset % 2 ? `"${color}"` : `"${dark}"`))) as T
const dot = (side: number) => {
  const pixels = new Uint8Array(side * side * 4)
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) pixels.set(Math.hypot(x + 0.5 - side / 2, y + 0.5 - side / 2) < side / 3 ? [255, 255, 255, 255] : [0, 0, 0, 0], (y * side + x) * 4)
  return `data:image/png;base64,${Buffer.from(encodePng(pixels, side, side)).toString("base64")}`
}
const flat = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })

export async function createImportBossSample(directory: string, theme: ImportTheme, target: TargetId = "forge-1.20.1") {
  const look = IMPORT_THEMES[theme]
  const created = await createProject({ directory, name: look.project, description: `${look.project}里住着${look.boss}。`, mod_id: look.mod_id, target })
  const ids = { sound: randomUUID(), particle: randomUUID(), fixture: randomUUID(), spike: randomUUID(), ability: randomUUID(), entity: randomUUID(), core: randomUUID(), token: randomUUID(), coreRecipe: randomUUID(), tokenRecipe: randomUUID() }
  const design = recolor(fightingGolemDesign, look.color, look.dark)
  const abilities = golemAbilities.map((ability) => ({
    ...ability,
    events: [
      // Minecraft 1.20.1 has no dust_plume: a project made for it raises a puff the game has (as `target-combined-sample.ts` does).
      ...ability.events.map((event) => (target === "forge-1.20.1" && event.type === "particle" && event.particle === "dust_plume" ? { ...event, particle: "poof" } : event)),
      ...(ability.id === "slam" ? [{ type: "particle", at: 0.7, particle: { asset: ids.particle }, count: 10, forward: 1.2, up: 0.3, left: 0, spread: 0.5 }, { type: "sound", at: 0.1, sound: { asset: ids.sound }, volume: 1.4, pitch: 1 }] : []),
    ],
  }))
  const boss = {
    bar: { color: "red", style: "notched_10", darken_sky: false },
    intro: null,
    phases: [],
    death: { seconds: 2, xp_bursts: 2, explosion: false },
    // A minute alone before the fight ends: long enough for a check on a server with nobody on it to watch it fight a stand-in.
    leash: { distance: 32, reset_seconds: 60 },
    summon: { item: "token", block: null, consume: true, cooldown: 5, ahead: 3 },
    arena: { fixtures: [{ id: "pillar", look: { asset: ids.fixture }, place: { ring: { count: 2, radius: 6 } }, use: { seconds: 1, cooldown: 3 }, clear: { radius: 4, seconds: 20 } }], fog: null },
  }
  const shared = [{ id: "ring_quake", asset: ids.ability, clip: "slam", windup: 0.1, facing: "lock", start: { min_distance: 0, max_distance: 8, line_of_sight: false, cooldown: 6, weight: 1 }, stopped_by_hurt: false, bones: { weapon: "arm_right" }, particles: { sparks: "flame" }, sounds: { impact: "entity.iron_golem.attack" }, damage_scale: 1 }]
  const entity = EntitySchema.parse({
    ...createEntity({ name: look.boss, description: `${look.project}的守护者。`, health: 120, speed: 0.22, attack_damage: 6, behavior: "hostile" }),
    name_en: look.boss_en,
    runtime: { spawn: null, explosion: null, movement: "direct", armor: 4, charging_armor: 4, texture_asset_id: null },
    sounds: { ambient: "entity.iron_golem.step", hurt: { asset: ids.sound }, death: "entity.iron_golem.death", step: "entity.iron_golem.step", pitch: 1, volume: 1 },
    loot: [{ item: "core", min: 1, max: 1, chance: 1, player_only: false }],
    experience: 20,
    abilities,
    shared_abilities: shared,
    boss,
  })
  const first = await saveProject(directory, { ...created, entities: [entity] }, created.revision)
  const modelled = (await putModelAsset(directory, { entity_id: entity.id, data: { design }, origin: "example", expectedRevision: first.revision })).project
  const mod = modelled.mod_id
  const content = ContentSchema.parse({
    items: [
      { id: ids.core, identifier: "core", name: "核心", name_en: "Core", max_stack: 16, color: look.color },
      { id: ids.token, identifier: "token", name: "召唤符", name_en: "Summoning Token", max_stack: 1, color: look.spark },
    ],
    blocks: [],
    recipes: [
      { id: ids.coreRecipe, name: "核心", pattern: [null, look.ore, null, look.ore, "minecraft:diamond", look.ore, null, look.ore, null], result: `${mod}:core`, count: 1 },
      { id: ids.tokenRecipe, name: "召唤符", pattern: [null, "minecraft:paper", null, "minecraft:paper", `${mod}:core`, "minecraft:paper", null, "minecraft:paper", null], result: `${mod}:token`, count: 1 },
    ],
    logic: [],
  })
  const filled = applyContent(modelled, content)
  const now = new Date().toISOString()
  const saved = (id: string, module: string, title: string, dependencies: string[], document: unknown) => WorkspaceAssetSchema.parse({ id, module, title, revision: 1, created_at: now, updated_at: now, prompt: title, dependencies, document, provenance: { model: "example", request_id: null }, status: "ready" })
  const roar: SoundDocument = { kind: "sound", name: "roar", files: [{ data: oggDataUrl(oggVorbis({ samples: look.samples })), duration: look.samples / 44100 }], subtitle: { zh: `${look.boss}怒吼`, en: `${look.boss_en} roars` }, category: "hostile", volume: 1, pitch: look.pitch }
  const spark = ParticleDocumentSchema.parse({ kind: "particle", name: "spark", frames: [dot(8), dot(8)], frames_by: "age", lifetime: 1, gravity: -0.1, size: { start: 0.2, end: 0.05 }, color: { start: look.spark, end: look.color }, opacity: { start: 1, end: 0 }, emissive: true, spin: 60 })
  const pillar = FixtureDocumentSchema.parse({
    kind: "fixture",
    name: "pillar",
    texture_size: 64,
    bones: [{ name: "base", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ name: "stone", origin: [-4, 0, -4], size: [8, 14, 8], faces: flat(look.dark) }, { name: "cap", origin: [-5, 14, -5], size: [10, 2, 10], faces: flat(look.color) }] }],
    animations: [
      { name: "dark", length: 2, loop: true, channels: [{ bone: "base", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [0, 4, 0] }, { time: 2, rotation: [0, 0, 0] }] }] },
      { name: "lit", length: 2, loop: true, channels: [{ bone: "base", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [0, 180, 0] }, { time: 2, rotation: [0, 360, 0] }] }] },
    ],
    play: { unlit: "dark", lit: "lit", glow: "lit" },
  })
  const quake = { ...abilityExamples(ids.spike)[1]!, bindings: [] }
  const { id: _id, model_asset_id: _model, ...rules } = entity
  return saveProject(
    directory,
    ProjectSchema.parse({
      ...filled,
      workspace: {
        assets: [
          ...filled.workspace.assets,
          saved(entity.id, "model", look.boss, [], { kind: "model", ...design }),
          saved(ids.sound, "sound", `${look.boss}的吼声`, [], roar),
          saved(ids.particle, "particle", "火星", [], spark),
          saved(ids.fixture, "fixture", "石柱", [], pillar),
          saved(ids.spike, "effect", golemEffects.spike.title, [], golemEffects.spike.document),
          saved(ids.ability, "ability", String(quake.name), [ids.spike], quake),
          saved(ids.entity, "entity", look.boss, [entity.id, ids.sound, ids.particle, ids.fixture, ids.ability], { kind: "entity", ...rules, model_asset_id: entity.id }),
        ],
      },
    }),
    filled.revision,
  )
}

if (import.meta.main) {
  const [directory, theme, target] = process.argv.slice(2) as [string | undefined, ImportTheme | undefined, TargetId | undefined]
  if (!directory || !theme || !(theme in IMPORT_THEMES)) throw new Error("Usage: bun packages/mod-core/script/import-boss-sample.ts <empty directory> <frost|lava|thorn> [target]")
  const project = await createImportBossSample(path.resolve(directory), theme, target)
  console.log(`${project.name} (${project.mod_id}, ${project.target}) written to ${path.resolve(directory)}`)
}

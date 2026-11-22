import { randomUUID } from "node:crypto"
import path from "node:path"
import { putModelAsset } from "../src/assets"
import { AbilityAssetDocumentSchema } from "../src/ability-asset"
import { ContentSchema } from "../src/content"
import { createEntity, createProject, EntitySchema, ProjectSchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { WorkspaceAssetSchema, applyContent } from "../src/workspace"
import { fightingGolemDesign } from "./data-gameplay-sample"

/**
 * 技能资产 in one project with a Chinese name, for Fabric 1.21.1, Forge 1.20.1 and NeoForge 1.21.1:
 * - 霜息 (channel, held): the item 「霜语法杖」 held down breathes a cone of frost every 10 ticks for 3 seconds — damage that grows with the experience level, slowness, snow;
 *   walking off or being hurt interrupts it; 6 seconds of cooldown.
 * - 回春 (instant, a block): a player right-clicking the block 「回春图腾」 makes it heal everyone on that player's side within 6 blocks and give them regeneration; 20 seconds.
 * - 三连弩 (charge, held): the item 「蓄能弩」 held for 1.2 seconds fires three arrows whose damage grows with the level and the attack damage attribute; its cooldown shrinks with the
 *   level; it may be cast twice more within 4 seconds before its wait; changing what is held calls off its charge.
 * - 火球术 (instant): the item 「火焰法典」 throws a small fireball, and the hostile creature 「炉火术士」 throws the same fireball as one of its own abilities (`shared_abilities`).
 *
 *   bun packages/mod-core/script/target-cast-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
export const CAST_SAMPLE_IDS = { frost: "ab111111-0000-4000-8000-000000000001", renewal: "ab111111-0000-4000-8000-000000000002", triple: "ab111111-0000-4000-8000-000000000003", fireball: "ab111111-0000-4000-8000-000000000004" } as const

export const frostBreath = AbilityAssetDocumentSchema.parse({
  kind: "ability",
  name: "霜息",
  english_name: "Frost Breath",
  cast: { type: "channel", seconds: 3, tick_every: 10, cooldown: 6, cancel_on: ["hurt", "move"] },
  sounds: { start: "entity.evoker.prepare_attack", loop: "entity.player.attack.sweep", end: "entity.player.attack.knockback" },
  reach: 12,
  hits: [{ type: "area", at: 0, shape: { type: "cone", up: 1.4, length: 7, angle: 40 }, hits: "everyone", damage: { base: 2, per_level: 0.1 }, knockback: 0, effects: [{ effect: "slowness", duration_ticks: 40, amplifier: 1 }] }],
  events: [{ type: "particle", at: 0, particle: "snowflake", where: "self", count: 12, forward: 2, up: 1.4, left: 0, spread: 1 }],
  moves: [],
  bindings: [{ type: "item", item: "frost_wand", use: "hold" }],
  scaling: { scales_with: ["level"] },
})

export const renewal = AbilityAssetDocumentSchema.parse({
  kind: "ability",
  name: "回春",
  english_name: "Renewal",
  cast: { type: "instant", seconds: 0, cooldown: 20 },
  sounds: { start: "entity.evoker.prepare_attack" },
  reach: 8,
  hits: [{ type: "area", at: 0.5, shape: { type: "sphere", forward: 0, up: 1, left: 0, radius: 6 }, hits: "allies", damage: 0, heal: 6, knockback: 0, effects: [{ effect: "regeneration", duration_ticks: 100, amplifier: 0 }] }],
  events: [{ type: "particle", at: 0.5, particle: "end_rod", where: "self", count: 30, forward: 0, up: 1.5, left: 0, spread: 3 }],
  moves: [],
  bindings: [{ type: "block", block: "renewal_totem" }],
})

export const tripleBolt = AbilityAssetDocumentSchema.parse({
  kind: "ability",
  name: "三连弩",
  english_name: "Triple Bolt",
  cast: { type: "charge", seconds: 1.2, cooldown: { base: 5, per_level: -0.05 }, recasts: { count: 2, within: 4 }, cancel_on: ["swap"] },
  reach: 32,
  hits: [0, 0.1, 0.2].map((at) => ({ type: "shot", at, projectile: "arrow", speed: 3, forward: 0.5, up: 1.5, damage: { base: 6, per_level: 0.25 } })),
  events: [{ type: "sound", at: 0, sound: "entity.arrow.shoot", volume: 1, pitch: 1.2 }],
  moves: [{ at: 0.2, forward: -0.3, up: 0 }],
  bindings: [{ type: "item", item: "charged_crossbow", use: "hold" }],
  scaling: { scales_with: ["level", "attribute:minecraft:generic.attack_damage"] },
})

export const fireball = AbilityAssetDocumentSchema.parse({
  kind: "ability",
  name: "火球术",
  english_name: "Fireball",
  cast: { type: "instant", seconds: 0, cooldown: 3 },
  reach: 24,
  hits: [{ type: "shot", at: 0, projectile: "small_fireball", speed: 1.2, forward: 0.6, up: 1.4, damage: null }],
  events: [{ type: "sound", at: 0, sound: "entity.blaze.shoot", volume: 1, pitch: 1 }],
  moves: [],
  bindings: [{ type: "item", item: "ember_tome", use: "click" }],
})

export async function createTargetCastSample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "霜火工坊", description: "霜语法杖、回春图腾、蓄能弩和火焰法典，还有一个会扔同一个火球的术士。", mod_id: "frost_hearth", target })
  const caster = EntitySchema.parse({
    ...createEntity({ name: "炉火术士", description: "远远地扔火球的石头术士。", health: 40, speed: 0.22, attack_damage: 3, behavior: "hostile" }),
    name_en: "Hearth Caster",
    shared_abilities: [{ asset: CAST_SAMPLE_IDS.fireball, id: "fireball", clip: "burst", windup: 0.6, facing: "track", start: { min_distance: 3, max_distance: 16, line_of_sight: true, cooldown: 4, weight: 3 }, stopped_by_hurt: false }],
  })
  const withCreature = await saveProject(directory, { ...created, entities: [caster] }, created.revision)
  const modelled = await putModelAsset(directory, { entity_id: caster.id, data: { design: fightingGolemDesign }, origin: "example", expectedRevision: withCreature.revision })
  const content = ContentSchema.parse({
    blocks: [{ id: randomUUID(), identifier: "renewal_totem", name: "回春图腾", name_en: "Renewal Totem", hardness: 2, luminance: 6, tool: "pickaxe", drop: "self", color: "#5FBF6A" }],
    items: [
      { id: randomUUID(), identifier: "frost_wand", name: "霜语法杖", name_en: "Frost Wand", max_stack: 1, color: "#9FD8F0" },
      { id: randomUUID(), identifier: "charged_crossbow", name: "蓄能弩", name_en: "Charged Crossbow", max_stack: 1, color: "#7A5A3A" },
      { id: randomUUID(), identifier: "ember_tome", name: "火焰法典", name_en: "Ember Tome", max_stack: 1, color: "#D0502A" },
    ],
    recipes: [],
    logic: [],
  })
  const withContent = applyContent(modelled.project, content)
  const now = new Date().toISOString()
  const saved = (id: string, title: string, document: unknown) => WorkspaceAssetSchema.parse({ id, module: "ability", title, revision: 1, created_at: now, updated_at: now, prompt: title, dependencies: [], document, provenance: { model: "example", request_id: null }, status: "ready" })
  return saveProject(
    directory,
    ProjectSchema.parse({
      ...withContent,
      workspace: {
        assets: [
          ...withContent.workspace.assets,
          saved(CAST_SAMPLE_IDS.frost, "霜息", frostBreath),
          saved(CAST_SAMPLE_IDS.renewal, "回春", renewal),
          saved(CAST_SAMPLE_IDS.triple, "三连弩", tripleBolt),
          saved(CAST_SAMPLE_IDS.fireball, "火球术", fireball),
        ],
      },
    }),
    modelled.project.revision,
  )
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-cast-sample.ts <empty directory> [target]")
  const project = await createTargetCastSample(path.resolve(directory), target as TargetId)
  console.log(`Cast project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}

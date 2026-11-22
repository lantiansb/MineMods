import path from "node:path"
import { putModelAsset } from "../src/assets"
import { AbilityAssetDocumentSchema } from "../src/ability-asset"
import type { AbilityScale } from "../src/ability-scale"
import { createEntity, createProject, EntitySchema, ProjectSchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { WorkspaceAssetSchema } from "../src/workspace"
import { fightingGolemDesign, golemEffects } from "./data-gameplay-sample"

/**
 * r29c: one ability asset played at two sizes. 「横冲」 is a charge: a dash of 12 blocks at 20 blocks a second carrying a box 4 wide, a shockwave from 1 to 6 blocks
 * where it stops and the sample's crystal spike shown there. 「石甲巨兽」 uses it as written; 「石甲幼兽」 uses the same asset with `scale` (0.5 unless told otherwise:
 * `scale: null` leaves the field out). Both wear the fighting golem's model and play its slam.
 *
 *   bun packages/mod-core/script/target-scale-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
export const SCALE_SAMPLE_IDS = { charge: "5ca1e000-0000-4000-8000-000000000001", spike: "5ca1e000-0000-4000-8000-000000000002" } as const

export const sideCharge = AbilityAssetDocumentSchema.parse({
  kind: "ability",
  name: "横冲",
  english_name: "Side Charge",
  cast: { type: "instant", seconds: 0, cooldown: 6 },
  reach: 16,
  length: 1.2,
  hits: [{ type: "area", at: 0.4, shape: { type: "box", forward: 1.5, up: 1, left: 0, width: 4, height: 2.5, depth: 2 }, hits: "everyone", damage: 10, knockback: 1, effects: [] }],
  moves: [{ type: "dash", from: 0.4, to: 1, speed: 20, distance: 12, aim: "locked_at_windup", stop_at_wall: true, hit: 0 }],
  events: [
    { type: "shockwave", at: 1, where: "self", hit: null, forward: 0, left: 0, from_radius: 1, to_radius: 6, seconds: 0.5, width: 1, height: 0.8, color: "#C08040", glow: false, damage: 4, knockback: 0.5, hits: "everyone", effects: [] },
    { type: "effect", at: 1, effect: SCALE_SAMPLE_IDS.spike, where: "self", hit: null, forward: 1, up: 0, left: 0 },
  ],
  bindings: [],
})

export async function createTargetScaleSample(directory: string, target: TargetId, options: { scale?: AbilityScale | null } = {}) {
  const created = await createProject({ directory, name: "石甲兽群", description: "石甲巨兽和它的幼兽，冲撞是同一招，幼兽冲得近、撞得窄。", mod_id: "stone_herd", target })
  const scale = options.scale === undefined ? 0.5 : options.scale
  const use = (id: string, start: { min_distance: number; max_distance: number }) => ({ asset: SCALE_SAMPLE_IDS.charge, id, clip: "slam", windup: 0.4, facing: "track", start: { ...start, line_of_sight: true, cooldown: 6, weight: 2 }, stopped_by_hurt: false })
  const creature = (name: string, name_en: string, health: number, charge: object) => EntitySchema.parse({
    ...createEntity({ name, description: `${name}会横着冲过来。`, health, speed: 0.22, attack_damage: 4, behavior: "hostile" }),
    name_en,
    shared_abilities: [charge],
  })
  const big = creature("石甲巨兽", "Stone Brute", 80, use("side_charge", { min_distance: 4, max_distance: 12 }))
  const small = creature("石甲幼兽", "Stone Cub", 24, { ...use("cub_charge", { min_distance: 2, max_distance: 6 }), ...(scale === null ? {} : { scale }) })
  const withCreatures = await saveProject(directory, { ...created, entities: [big, small] }, created.revision)
  const first = await putModelAsset(directory, { entity_id: big.id, data: { design: fightingGolemDesign }, origin: "example", expectedRevision: withCreatures.revision })
  const second = await putModelAsset(directory, { entity_id: small.id, data: { design: fightingGolemDesign }, origin: "example", expectedRevision: first.project.revision })
  const now = new Date().toISOString()
  const saved = (id: string, module: string, title: string, dependencies: string[], document: unknown) => WorkspaceAssetSchema.parse({ id, module, title, revision: 1, created_at: now, updated_at: now, prompt: title, dependencies, document, provenance: { model: "example", request_id: null }, status: "ready" })
  return saveProject(
    directory,
    ProjectSchema.parse({
      ...second.project,
      workspace: {
        assets: [
          ...second.project.workspace.assets,
          saved(SCALE_SAMPLE_IDS.spike, "effect", golemEffects.spike.title, [], golemEffects.spike.document),
          saved(SCALE_SAMPLE_IDS.charge, "ability", sideCharge.name, [SCALE_SAMPLE_IDS.spike], sideCharge),
        ],
      },
    }),
    second.project.revision,
  )
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-scale-sample.ts <empty directory> [target]")
  const project = await createTargetScaleSample(path.resolve(directory), target as TargetId)
  console.log(`Scale project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}

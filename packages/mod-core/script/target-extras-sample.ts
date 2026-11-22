import { randomUUID } from "node:crypto"
import path from "node:path"
import { putModelAsset } from "../src/assets"
import { ContentSchema } from "../src/content"
import { createEntity, createProject, EntitySchema, ProjectSchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { WorkspaceAssetSchema, applyContent } from "../src/workspace"
import { livingGolemDesign, longCreatureDesign } from "./data-gameplay-sample"

/**
 * The rest of a creature (平台层-移植清单.md, E2 / creature-extras) in one project with a Chinese name, for Forge 1.20.1 and NeoForge 1.21.1
 * (and Fabric 1.21.1, the same project by Fabric's own text):
 * - 「糖角羊」: a follower drawn by two lures (a vanilla item and the project's own), without a runtime (the game's TemptGoal);
 * - 「蜜角羊」: the same lures with a runtime (its own goal checks the lures);
 * - 「火药菇」: a creature that explodes like a creeper three blocks from a player: a fuse of 30 ticks, a radius of 3 that breaks blocks, slowness and
 *   poison on the players it catches;
 * - 「宝箱怪」: a passive creature that always drops the project's lucky cache when a player kills it (not by an explosion);
 * - 「怒火菇」: a creature that explodes at whomever it is set on (it picks nobody by itself: `engagement: none_by_itself`), after a fuse of 60
 *   ticks, without breaking blocks;
 * - the lucky cache 「好运箱」 (diamonds, or poison) and the item 「糖块」 the goats follow.
 *
 *   bun packages/mod-core/script/target-extras-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */
export const EXTRAS_SAMPLE = {
  lures: ["minecraft:carrot", "sugar_lump"],
  explosion: { fuse_ticks: 30, radius: 3, damage_blocks: true, effects: [{ effect: "slowness", duration_ticks: 200, amplifier: 1 }, { effect: "poison", duration_ticks: 100, amplifier: 0 }] },
  keepingExplosion: { fuse_ticks: 60, radius: 3, damage_blocks: false, effects: [] },
  cache: "lucky_box",
} as const

const runtime = { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null } as const

export async function createTargetExtrasSample(directory: string, target: TargetId) {
  const created = await createProject({ directory, name: "糖角牧场", description: "糖角羊跟着拿糖的人走，火药菇会自爆，宝箱怪死了会掉好运箱。", mod_id: "sugar_ranch", target })
  const goat = EntitySchema.parse({
    ...createEntity({ name: "糖角羊", description: "跟着拿胡萝卜或糖块的人走。", health: 16, speed: 0.25, attack_damage: 0, behavior: "follow" }),
    name_en: "Sugar Goat",
    tempt: [...EXTRAS_SAMPLE.lures],
  })
  const runner = EntitySchema.parse({
    ...createEntity({ name: "蜜角羊", description: "跟着拿胡萝卜或糖块的人跑。", health: 16, speed: 0.25, attack_damage: 0, behavior: "follow" }),
    name_en: "Honey Goat",
    tempt: [...EXTRAS_SAMPLE.lures],
    runtime,
  })
  const shroom = EntitySchema.parse({
    ...createEntity({ name: "火药菇", description: "走到人跟前就炸。", health: 20, speed: 0.25, attack_damage: 0, behavior: "hostile" }),
    name_en: "Powder Shroom",
    runtime: { ...runtime, explosion: EXTRAS_SAMPLE.explosion },
  })
  const fused = EntitySchema.parse({
    ...createEntity({ name: "怒火菇", description: "谁惹它就冲谁去炸，不炸坏方块。", health: 20, speed: 0.25, attack_damage: 0, behavior: "hostile" }),
    name_en: "Wrath Shroom",
    engagement: "none_by_itself",
    runtime: { ...runtime, explosion: EXTRAS_SAMPLE.keepingExplosion },
  })
  const mimic = EntitySchema.parse({
    ...createEntity({ name: "宝箱怪", description: "被玩家打败时掉一个好运箱。", health: 10, speed: 0.2, attack_damage: 0, behavior: "passive" }),
    name_en: "Mimic",
    runtime,
  })
  let project = await saveProject(directory, { ...created, entities: [goat, runner, shroom, mimic, fused] }, created.revision)
  for (const [entity, design] of [[goat, longCreatureDesign], [runner, longCreatureDesign], [shroom, livingGolemDesign], [mimic, livingGolemDesign], [fused, livingGolemDesign]] as const)
    project = (await putModelAsset(directory, { entity_id: entity.id, data: { design }, origin: "example", expectedRevision: project.revision })).project
  const content = ContentSchema.parse({
    items: [{ id: randomUUID(), identifier: "sugar_lump", name: "糖块", name_en: "Sugar Lump", max_stack: 64, color: "#F4E6C8" }],
    blocks: [
      {
        id: randomUUID(), identifier: EXTRAS_SAMPLE.cache, name: "好运箱", name_en: "Lucky Box", hardness: 1, luminance: 3, tool: "axe", drop: "self", color: "#E0B040",
        lucky: { max_stack: 16, outcomes: [{ weight: 70, items: [{ item: "minecraft:diamond", min: 2, max: 3 }], effects: [] }, { weight: 30, items: [], effects: [{ effect: "poison", duration_ticks: 100, amplifier: 0 }] }] },
      },
    ],
    recipes: [],
    logic: [],
  })
  project = await saveProject(directory, applyContent(project, content), project.revision)
  // The mimic drops the cache. As Studio itself saves a creature with a death drop: its model and its rules are workspace assets, and its rules depend on the cache's.
  const box = project.workspace.assets.find((asset) => asset.document.kind === "block" && asset.document.identifier === EXTRAS_SAMPLE.cache)!
  const withDrop = { ...project.entities.find((entity) => entity.id === mimic.id)!, runtime: { ...runtime, death_drop: { block_identifier: EXTRAS_SAMPLE.cache, chance: 1 } } }
  const now = new Date().toISOString()
  const saved = (id: string, module: string, title: string, dependencies: string[], document: unknown) =>
    WorkspaceAssetSchema.parse({ id, module, title, revision: 1, created_at: now, updated_at: now, prompt: "宝箱怪", dependencies, document, provenance: { model: "example", request_id: null }, status: "ready" })
  const { id: _id, model_asset_id: _model, ...rules } = withDrop
  return saveProject(
    directory,
    ProjectSchema.parse({
      ...project,
      entities: project.entities.map((entity) => (entity.id === mimic.id ? withDrop : entity)),
      workspace: {
        assets: [
          ...project.workspace.assets,
          saved(mimic.id, "model", mimic.name, [], { kind: "model", ...livingGolemDesign }),
          saved(randomUUID(), "entity", mimic.name, [mimic.id, box.id], { kind: "entity", ...rules, model_asset_id: mimic.id }),
        ],
      },
    }),
    project.revision,
  )
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-extras-sample.ts <empty directory> [target]")
  const project = await createTargetExtrasSample(path.resolve(directory), target as TargetId)
  console.log(`Extras project "${project.name}" (${project.mod_id}, ${project.target}) created in ${path.resolve(directory)}.`)
}

import path from "node:path"
import { randomUUID } from "node:crypto"
import { putModelAsset } from "../src/assets"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { WorkspaceAssetSchema } from "../src/workspace"
import { fightingGolemDesign } from "./data-gameplay-sample"
import { lantern } from "./target-fixtures-sample"

const faces = (color: string) => Object.fromEntries(["north", "south", "east", "west", "up", "down"].map(side => [side, color]))
const bone = (name: string, parent: string | null, origin: number[], size: number[], color: string) => ({
  name, parent, pivot: origin, rotation: [0, 0, 0], cubes: [{ name, origin, size, faces: faces(color) }],
})
const clip = (name: string, length: number, loop: boolean, bone: string, tilt: number) => ({
  name, length, loop, channels: [{ bone, keyframes: [
    { time: 0, rotation: [0, 0, 0] }, { time: length / 2, rotation: [tilt, 0, 0] }, { time: length, rotation: [0, 0, 0] },
  ] }],
})
const shellDesign = {
  ...fightingGolemDesign, name: "石甲龟",
  bones: [
    bone("body", null, [-10, 3, -9], [20, 8, 18], "#517037"),
    bone("shell", "body", [-9, 9, -8], [18, 6, 16], "#647F45"),
    bone("head", "body", [-4, 4, -16], [8, 7, 8], "#80967A"),
    ...[-1, 1].flatMap(x => [-1, 1].map(z => bone(`foot_${x < 0 ? "l" : "r"}${z < 0 ? "f" : "b"}`, "body", [x * 8 - 2, 0, z * 6 - 2], [5, 5, 5], "#53634C"))),
  ],
  animations: [
    clip("idle", 1.4, true, "body", 1), clip("walk", 0.7, true, "body", 4), clip("hurt", 0.4, false, "body", -8),
    clip("unfold", 0.5, false, "head", 25), clip("roll", 1.2, false, "body", 50), clip("bite", 1.2, false, "head", -30),
  ],
}
const knightDesign = {
  ...fightingGolemDesign, name: "岩盾骑士",
  bones: [...fightingGolemDesign.bones, bone("shield_model", "arm_left", [6, 12, -9], [10, 14, 2], "#688FA6")],
}
const sentinelDesign = {
  ...fightingGolemDesign, name: "灯庭守望者",
  bones: [...fightingGolemDesign.bones, bone("eye_light", "head", [-2, 29, -10], [4, 3, 2], "#FFCA5E")],
}
const lamp = "90d460bd-c5da-495b-a410-196ed428f35d"
const start = { min_distance: 0, max_distance: 16, line_of_sight: false, cooldown: 1, weight: 1 }
const move = (id: string, name: string, clip = "slam") => ({
  id, name, clip, windup: 0.35, length: 1.2, facing: "lock", start,
  stopped_by_hurt: false, events: [], moves: [],
  hits: [{ type: "area", at: 0.85, hits: "target", damage: 2, knockback: 0, effects: [],
    shape: { type: "sphere", forward: 0, up: 0.7, left: 0, radius: 4 },
    warn: { seconds: 0.4, look: "ring", color: "yellow" } }],
})
const part = (name: string, forward: number, up: number) => ({ name, forward, up, left: 0, width: 1, height: 0.8 })
const base = (name: string) => ({
  ...createEntity({ name, description: name, health: 100, speed: 0.22, attack_damage: 1, behavior: "hostile" }),
  engagement: "any_player", steady: { preset: "auto" },
  runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null },
})
const clear = { radius: 2, seconds: 5 }
const fixture = (id: string, left: number) => ({
  id, look: { asset: lamp }, place: { forward: 4, left },
  use: { by: "hit", seconds: 0, cooldown: 0.1, lit_seconds: null }, clear,
})

export const turtle = () => EntitySchema.parse({
  ...base("石甲龟"),
  hitbox: { core: { width: 1.4, height: 1.3 }, parts: [part("shell", 0, 0.7), part("head", 0.9, 0.45)] },
  abilities: [move("roll", "翻滚", "roll"), {
    ...move("bite", "咬合", "bite"), openings: [{ from: 0, to: 0.8, part: "head", damage_scale: 2, group: "head" }],
    breaks: [{ group: "head", hits: 1, result: { stance: "shell" } }],
  }],
  stances: { start: "shell", list: [
    { id: "shell", name: "缩壳", clips: { walk: null }, model: { hide: ["head"] },
      part_scales: [{ part: "shell", damage_scale: 0 }], abilities: ["roll"], max_seconds: 2, then: "head_out" },
    { id: "head_out", name: "探头", clips: { idle: "idle" }, model: { show: ["head"] }, abilities: ["bite"],
      change: { clip: "unfold", seconds: 0.5 }, events: [{ type: "sound", sound: "block.anvil.land", volume: 0.4, pitch: 1.2 }] },
  ] },
})
export const knight = () => EntitySchema.parse({
  ...base("岩盾骑士"),
  guard: { arc: 130, damage_scale: 0.2, by: "any" },
  abilities: [
    move("bash", "盾击"),
    { ...move("lower", "落盾"), start: { ...start, cooldown: 0.25, weight_when: [{ if: "stance", id: "raised", scale: 0 }] }, stopped_by_hurt: true,
      interrupt: { hits: 1 }, events: [{ type: "stance", to: "lowered", at: 0.65 }] },
    { ...move("heave", "重劈"), start: { ...start, when: [{ if: "stance", id: "lowered" }],
      weight_when: [{ if: "stance", id: "lowered", scale: 2 }] } },
  ],
  stances: { start: "raised", list: [
    { id: "raised", name: "举盾", model: { show: ["shield_model"] }, abilities: ["bash", "lower"],
      leave: { after_seconds: 1.5, ability: "lower", retry_seconds: 0.5, max_delays: 1 } },
    { id: "lowered", name: "放盾", model: { hide: ["shield_model"] }, guard: null, abilities: ["heave"], max_seconds: 2, then: "raised" },
  ] },
})
export const sentinel = () => EntitySchema.parse({
  ...base("灯庭守望者"),
  abilities: [move("rake", "横扫"), move("slam", "重踏")],
  boss: {
    bar: { color: "yellow", style: "progress", darken_sky: false },
    intro: null,
    phases: [{ below: 0.65, seconds: 0.5, clip: null, speed: 1, damage: 1, bar_color: null,
      abilities: ["rake", "slam"], stances: { closed: { max_seconds: 2 } } }],
    death: { seconds: 2, xp_bursts: 0, explosion: false, steps: [{ type: "stance", at: 0.2, to: "closed" }] },
    leash: { distance: 24, reset_seconds: 5 },
    arena: { fixtures: [fixture("left_lamp", 2), fixture("right_lamp", -2)], fog: null },
  },
  stances: { start: "closed", list: [
    { id: "closed", name: "闭眼", model: { hide: ["eye_light"] }, abilities: ["rake"], max_seconds: 9, then: "open",
      when: [{ if: "fixtures_lit", count: 2, to: "open" }] },
    { id: "open", name: "睁眼", model: { show: ["eye_light"] }, abilities: ["slam"], max_seconds: 3, then: "closed", bar: { color: "red" }, ambient: { sky: 0.25, tint: "#744C84", visibility: 16 } },
  ] },
})

export async function createTargetStancesSample(directory: string, target: TargetId) {
  const entities = [turtle(), knight(), sentinel()]
  const draft = await createProject({ directory, target, mod_id: "stance_hollows", name: "磐石庭", description: "石甲龟、岩盾骑士和灯庭守望者。" })
  const now = new Date().toISOString()
  const designs = [shellDesign, knightDesign, sentinelDesign]
  const saved = (id: string, module: "model" | "entity", title: string, dependencies: string[], document: unknown) =>
    WorkspaceAssetSchema.parse({ id, module, title, dependencies, document,
      revision: 1, prompt: title, status: "ready", provenance: { model: "example", request_id: null }, created_at: now, updated_at: now })
  const fixtureAsset = WorkspaceAssetSchema.parse({
    id: lamp, module: "fixture", document: lantern, title: "庭灯", revision: 1, prompt: "庭灯", status: "ready", provenance: { model: "example", request_id: null },
    dependencies: [], created_at: now, updated_at: now,
  })
  let project = await saveProject(directory, { ...draft, entities, workspace: { ...draft.workspace, assets: [fixtureAsset] } }, draft.revision)
  for (const [index, entity] of entities.entries())
    project = (await putModelAsset(directory, { entity_id: entity.id, data: { design: designs[index]! }, origin: "example", expectedRevision: project.revision })).project
  const assets = entities.flatMap(({ id, model_asset_id: _asset, ...entity }, index) => [
    saved(id, "model", entity.name, [], { kind: "model", ...designs[index]! }),
    saved(randomUUID(), "entity", entity.name, [id, ...(entity.boss ? [lamp] : [])], { kind: "entity", ...entity, model_asset_id: id }),
  ])
  return saveProject(directory, { ...project, workspace: { ...project.workspace, assets: [fixtureAsset, ...assets] } }, project.revision)
}

if (import.meta.main) {
  const [directory, target = "forge-1.20.1"] = process.argv.slice(2)
  if (!directory) throw new Error("Usage: bun script/target-stances-sample.ts <directory> [target]")
  await createTargetStancesSample(path.resolve(directory), target as TargetId)
}

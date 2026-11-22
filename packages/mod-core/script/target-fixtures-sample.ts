import path from "node:path"
import { randomUUID } from "node:crypto"
import { putModelAsset } from "../src/assets"
import { FixtureDocumentSchema } from "../src/fixture"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import { WorkspaceAssetSchema } from "../src/workspace"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign } from "./data-gameplay-sample"

const lamp = "90d460bd-c5da-495b-a410-196ed428f35d"
const faces = (color: string) =>
  Object.fromEntries(["north", "south", "east", "west", "up", "down"].map((side) => [side, color]))
const cube = (name: string, origin: number[], size: number[], color: string) => ({
  name,
  origin,
  size,
  faces: faces(color),
})
const motion = (name: string, scale: number, dy: number) => ({
  name,
  length: 1,
  loop: true,
  channels: [
    {
      bone: "flame",
      keyframes: [],
      scale: [
        { time: 0, scale: [scale, scale, scale] },
        { time: 1, scale: [scale, scale, scale] },
      ],
      position: [{ time: 0, position: [0, dy, 0] }],
    },
  ],
})
export const lantern = FixtureDocumentSchema.parse({
  kind: "fixture",
  name: "signal_lamp",
  texture_size: 64,
  bones: [
    {
      name: "base",
      parent: null,
      pivot: [0, 0, 0],
      rotation: [0, 0, 0],
      cubes: [
        cube("foot", [-7, 0, -7], [14, 3, 14], "#433D36"),
        cube("pedestal", [-4, 3, -4], [8, 11, 8], "#645944"),
        cube("bowl", [-7, 14, -7], [14, 3, 14], "#80613F"),
      ],
    },
    {
      name: "flame",
      parent: "base",
      pivot: [0, 17, 0],
      rotation: [0, 0, 0],
      cubes: [cube("coal", [-4, 17, -4], [8, 5, 8], "#C95328"), cube("fire", [-2, 22, -2], [4, 7, 4], "#FFD26C")],
    },
  ],
  animations: [motion("cold", 0.03, 0), motion("burning", 1, 0), motion("ember", 0.4, 0)],
  play: { unlit: "cold", lit: "burning", ember: "ember", glow: "lit" },
})
const start = { min_distance: 0, max_distance: 32, line_of_sight: false, cooldown: 4, weight: 1 }
const base = { clip: "attack", windup: 0.2, length: 1.5, facing: "lock", moves: [], stopped_by_hurt: true, start }
const sphere = {
  type: "area",
  at: 0.5,
  shape: { type: "sphere", forward: 0, up: 0.7, left: 0, radius: 1.5 },
  hits: "everyone",
  damage: 1,
  knockback: 0,
  effects: [],
}
const pair = { if: "fixtures_lit", count: 2, within_arc: 90 }
const change = (at: number, action: string, which: unknown, every_seconds?: number) => ({
  type: "fixture",
  at,
  do: action,
  which,
  ...(every_seconds ? { every_seconds } : {}),
})
export async function createFixturesSample(
  directory: string,
  target: TargetId,
  only?: "switches" | "guard",
  validation = false,
  extraGuardName?: string,
) {
  const made = await createProject({
    directory,
    target,
    name: only === "switches" ? "无雾双开关" : only === "guard" ? "吹灯守卫" : "烽灯石庭",
    description: "两座无雾开关与会吹灭火盆的守卫。",
    mod_id: only === "switches" ? "stone_switches" : only === "guard" ? "lantern_guard" : "fixture_garden",
  })
  const group = (id: string, forward: number, left: number, seconds: number | null) => ({
    id,
    place: { forward, left },
    look: { asset: lamp },
    light: 15,
    ember_light: 4,
    use: { by: "hit", seconds: 0, cooldown: 0.1, lit_seconds: seconds },
    clear: { radius: 3, seconds: 5 },
  })
  const boss = {
    bar: { color: "yellow", style: "progress", darken_sky: false },
    intro: null,
    phases: [],
    leash: null,
    death: { seconds: 2, xp_bursts: 0, explosion: false },
  }
  const shapes = [
    {
      key: "switches",
      name: "双灯门卫",
      stagger: { seconds: 1, damage_scale: 2, when: [pair] },
      abilities: [
        {
          ...base,
          id: "tap",
          name: "叩石",
          hits: [sphere],
          events: [],
          start: { ...start, when: [pair], weight_when: [{ ...pair, scale: 2 }] },
        },
      ],
      boss: { ...boss, arena: { fixtures: [group("east", 4, 2, 0.5), group("west", 4, -2, null)], fog: null } },
    },
    {
      key: "guard",
      name: "吹灯守卫",
      abilities: [
        {
          ...base,
          id: "gust",
          name: "吹灭近灯",
          hits: [{ ...sphere, shape: { type: "sphere", forward: 4, up: 0.7, left: 0, radius: 2 } }],
          events: [change(0.5, "ember", { in_hit: 0 })],
        },
        {
          ...base,
          id: "lamp_strike",
          name: "敲击亮灯",
          hits: [{ ...sphere, place: { fixture: "lit_nearest" } }],
          events: [],
        },
        { ...base, id: "relay", name: "巡灯", hits: [sphere], events: [change(0.1, "light", "all", 0.3)] },
        ...(validation
          ? [
              {
                ...base,
                id: "storm",
                name: "巡灯雷",
                hits: [sphere],
                events: [{ type: "lightning", at: 0.6, place: { fixture: "lit_random" }, damage: 1, radius: 2 }],
              },
              {
                ...base,
                id: "fall",
                name: "镇灯石",
                hits: [
                  {
                    type: "projectile",
                    at: 0.6,
                    look: { bone: "arm_left" },
                    place: { fixture: "lit_nearest" },
                    from: { sky: { over: "self", height: 6 } },
                    speed: 1.2,
                    gravity: 0.04,
                    path: "straight",
                    damage: 1,
                    knockback: 0,
                    effects: [],
                    radius: 1,
                  },
                ],
                events: [],
              },
            ]
          : []),
      ],
      boss: {
        ...boss,
        death: { ...boss.death, steps: [change(0.2, "light", "all", 0.35)] },
        arena: {
          fixtures: [group("front", 4, 0, null), group("far", 0, 6, null)],
          fog: validation ? {visibility:6, fade_seconds:0.5, boss_damage:1, damage_taken:1, lift:"never"} : null,
        },
      },
    },
  ]
  if (extraGuardName) shapes.push({...shapes[1]!, name:extraGuardName})
  const runtime = {
    spawn: null,
    explosion: null,
    movement: "direct",
    armor: 0,
    charging_armor: 0,
    texture_asset_id: null,
  }
  const entities = shapes
    .filter((shape) => !only || only === shape.key)
    .map(({ key, ...shape }) =>
      EntitySchema.parse({
        ...createEntity({
          name: shape.name,
          description: shape.name,
          health: 120,
          speed: 0.2,
          attack_damage: 3,
          behavior: "hostile",
        }),
        ...shape,
        runtime,
        stationary: { reason: "守在石庭中央" },
      }),
    )
  let project = await saveProject(directory, { ...made, entities }, made.revision)
  const assets = []
  const now = new Date().toISOString()
  for (const entity of entities) {
    const design = {
      ...fightingGolemDesign,
      name: entity.name,
      animations: fightingGolemDesign.animations.map((clip) =>
        clip.name === "attack" ? { ...clip, length: 1.5 } : clip,
      ),
    }
    const row = {
      revision: 1,
      created_at: now,
      updated_at: now,
      prompt: entity.name,
      provenance: { model: "example", request_id: null },
      status: "ready",
    }
    assets.push(
      WorkspaceAssetSchema.parse({
        ...row,
        id: entity.id,
        module: "model",
        title: entity.name + "外观",
        dependencies: [],
        document: { kind: "model", ...design },
      }),
    )
    const { id, model_asset_id, ...fields } = entity
    assets.push(
      WorkspaceAssetSchema.parse({
        ...row,
        id: randomUUID(),
        module: "entity",
        title: entity.name,
        dependencies: [id, lamp],
        document: { kind: "entity", ...fields, model_asset_id: id, runtime },
      }),
    )
    project = (
      await putModelAsset(directory, {
        entity_id: entity.id,
        data: { design },
        origin: "example",
        expectedRevision: project.revision,
      })
    ).project
  }
  const asset = WorkspaceAssetSchema.parse({
    id: lamp,
    module: "fixture",
    title: "三态烽灯",
    revision: 1,
    created_at: now,
    updated_at: now,
    prompt: "烽灯",
    dependencies: [],
    document: lantern,
    provenance: { model: "example", request_id: null },
    status: "ready",
  })
  return saveProject(
    directory,
    { ...project, workspace: { ...project.workspace, assets: [...project.workspace.assets, asset, ...assets] } },
    project.revision,
  )
}
if (import.meta.main) {
  const [dir, target = "forge-1.20.1", only] = process.argv.slice(2)
  if (!dir) throw Error("需要空目录")
  console.log(
    (await createFixturesSample(path.resolve(dir), target as TargetId, only as "switches" | "guard" | undefined)).name,
  )
}

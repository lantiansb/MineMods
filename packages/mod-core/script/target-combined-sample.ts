import path from "node:path"
import { BossBarDocumentSchema } from "../src/boss-bar"
import { AbilitySchema, BossSchema, ComboSchema, EntitySchema, type Ability } from "../src/entity-runtime"
import { ParticleDocumentSchema } from "../src/particle"
import { encodePng } from "../src/png"
import { saveProject } from "../src/project"
import type { SoundDocument } from "../src/sound"
import type { TargetId } from "../src/target/ids"
import { WorkspaceAssetSchema } from "../src/workspace"
import { oggDataUrl, oggVorbis } from "../test/ogg-sample"
import { createDataGameplaySample, golemAbilities } from "./data-gameplay-sample"

/**
 * The asset kinds and boss features that were made apart, in one creature of one project (「晶石傀儡」 of 「蓝晶矿洞」): a sound of the project's own
 * (its roar, also its hurt sound), embers of its own and a weapon trail on its slam, a boss with a bar of its own (a wake-up, two phases at 66% and 33%,
 * a death played out, a leash), a combo of three abilities and a ground slam warned by a red ring. `test/combined-assets.test.ts` builds it for every
 * target and compiles the tree; `target-combined-check.ts` builds it with Gradle and runs it on a real dedicated server.
 *
 *   bun packages/mod-core/script/target-combined-sample.ts <empty directory> [forge-1.20.1|neoforge-1.21.1|fabric-1.21.1]
 */

export const ROAR_ID = "c0ffee00-0000-4000-8000-000000000001"
export const EMBER_ID = "c0ffee00-0000-4000-8000-000000000002"
export const BAR_ID = "c0ffee00-0000-4000-8000-000000000003"

const dot = (side: number) => {
  const pixels = new Uint8Array(side * side * 4)
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) pixels.set(Math.hypot(x + 0.5 - side / 2, y + 0.5 - side / 2) < side / 3 ? [255, 255, 255, 255] : [0, 0, 0, 0], (y * side + x) * 4)
  return `data:image/png;base64,${Buffer.from(encodePng(pixels, side, side)).toString("base64")}`
}
const roar: SoundDocument = { kind: "sound", name: "golem_roar", files: [{ data: oggDataUrl(oggVorbis({ samples: 44100 })), duration: 1 }], subtitle: { zh: "傀儡怒吼", en: "Golem roars" }, category: "hostile", volume: 1, pitch: 1 }
const ember = ParticleDocumentSchema.parse({ kind: "particle", name: "ember", frames: [dot(8), dot(8)], frames_by: "age", lifetime: 1, gravity: -0.2, size: { start: 0.2, end: 0.05 }, color: { start: "#ffcc66", end: "#ff3300" }, opacity: { start: 1, end: 0 }, emissive: true, spin: 90 })
const bar = BossBarDocumentSchema.parse({ kind: "bossbar", background: "bronze", fill: null, drain: "left", segments: [], lock: { frames: null, ticks: 4, at: [] }, icons: [{ abilities: ["slam"], image: null, at: null }, { abilities: ["burst"], image: null, at: null }], names: [{ zh: "苏醒", en: "Awakened" }, { zh: "狂怒", en: "Enraged" }, { zh: "垂死", en: "Last Stand" }], name_at: null, dots: null })

const [slam, burst] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability, Ability]
// The slam swings its right arm: a trail behind the arm's far end, embers of the project's own and its own roar.
const swing = AbilitySchema.parse({
  ...slam,
  events: [...slam.events, { type: "trail", at: 0.5, until: 0.75, bone: "arm_right", color: "#66ccff", width: 0.4, fade_ticks: 6 }, { type: "particle", at: 0.7, particle: { asset: EMBER_ID }, count: 8, forward: 1.2, up: 0.2, left: 0, spread: 0.4 }, { type: "sound", at: 0.1, sound: { asset: ROAR_ID }, volume: 1.5, pitch: 1 }],
})
// A ground slam at the target's feet, warned by a red ring.
const quake = AbilitySchema.parse({ ...slam, id: "quake", name: "震地", hits: [{ type: "area", at: 1, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 2.5 }, hits: "everyone", damage: 6, knockback: 0.6, effects: [], place: "target", warn: { seconds: 0.8, look: "ring", color: "red" } }] })
const combo = ComboSchema.parse({ id: "triple", name: "三连击", steps: ["slam", "burst", "quake"], gap_ticks: 2, damage_scale: 1.2, start: { min_distance: 0, max_distance: 2.8, line_of_sight: true, cooldown: 10, weight: 2 } })
const boss = BossSchema.parse({
  bar: { color: "purple", style: "notched_10", darken_sky: true, look: { asset: BAR_ID } },
  intro: { wake_distance: 16, clip: "roar", seconds: 0.8, sound: "entity.iron_golem.attack" },
  phases: [
    { below: 0.66, clip: "wave", seconds: 1, bar_color: "red", speed: 1.15, damage: 1.3, abilities: ["slam"] },
    { below: 0.33, clip: "wave", seconds: 1, bar_color: null, speed: 1.3, damage: 1.6, abilities: [] },
  ],
  death: { seconds: 4, xp_bursts: 6, explosion: true },
  leash: { distance: 48, reset_seconds: 30 },
})

/**
 * The combined project in `directory`. Minecraft 1.20.1 has no `dust_plume`: for Forge 1.20.1 the golem's slams raise a puff the game has
 * (as `target-ability-sample.ts` does), else nothing changes.
 */
export async function createCombinedSample(directory: string, target?: TargetId) {
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const golem = sample.entities[0]!
  const forOldGame = (ability: Ability) => (target === "forge-1.20.1" ? { ...ability, events: ability.events.map((event) => (event.type === "particle" && event.particle === "dust_plume" ? { ...event, particle: "poof" as const } : event)) } : ability)
  const abilities = EntitySchema.shape.abilities.unwrap().unwrap().parse([swing, burst, quake].map(forOldGame))
  const combos = [combo]
  const sounds = { ...golem.sounds!, hurt: { asset: ROAR_ID } }
  const now = new Date().toISOString()
  const saved = (id: string, module: string, title: string, document: unknown) => WorkspaceAssetSchema.parse({ id, module, title, revision: 1, created_at: now, updated_at: now, prompt: title, dependencies: [], document, provenance: { model: null, request_id: null }, status: "ready" })
  const assets = [
    saved(ROAR_ID, "sound", "傀儡怒吼", roar),
    saved(EMBER_ID, "particle", "余烬", ember),
    saved(BAR_ID, "bossbar", "青铜血条", bar),
    ...sample.workspace.assets.map((asset) =>
      asset.document.kind === "entity" && asset.document.model_asset_id === golem.id
        ? { ...asset, dependencies: [...asset.dependencies, ROAR_ID, EMBER_ID, BAR_ID], document: { ...asset.document, abilities, combos, sounds, boss } }
        : asset,
    ),
  ]
  return saveProject(directory, { ...sample, entities: [{ ...golem, abilities, combos, sounds, boss }], workspace: { assets } }, sample.revision)
}

if (import.meta.main) {
  const [directory, target] = process.argv.slice(2) as [string | undefined, TargetId | undefined]
  if (!directory) throw new Error("Usage: bun packages/mod-core/script/target-combined-sample.ts <empty directory> [target]")
  const project = await createCombinedSample(path.resolve(directory), target)
  console.log(`${project.name} (${project.mod_id}) written to ${path.resolve(directory)}`)
}

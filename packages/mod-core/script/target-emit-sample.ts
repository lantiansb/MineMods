import { randomUUID } from "node:crypto"
import { putModelAsset } from "../src/assets"
import { AbilitySchema } from "../src/entity-runtime"
import { createEntity, createProject, EntitySchema, saveProject } from "../src/project"
import { encodePng } from "../src/png"
import { WorkspaceAssetSchema } from "../src/workspace"
import { BlockSchema } from "../src/content"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign } from "./data-gameplay-sample"

const id = (n: number) => `eb111111-0000-4000-8000-${String(n).padStart(12, "0")}`
export const emitKeys = [1, 2, 3].map(n => `ember_yard:creature_${id(n).replaceAll("-", "")}`)
const frame = (fog: boolean) => {
  const pixels = new Uint8Array(8 * 8 * 4)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const d = Math.hypot((x - 3.5) / (fog ? 3.6 : 2), (y - 3.5) / (fog ? 1.6 : 2.8))
    pixels.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - d * d))], 4 * (y * 8 + x))
  }
  return "data:image/png;base64," + Buffer.from(encodePng(pixels, 8, 8)).toString("base64")
}
const burst = { type: "particle", at: 0.15, forward: 0, up: 0, left: 0, spread: 0.08, count: 4, particle: { alias: "火星" } }
const makeMove = (id: string, name: string, events: unknown[]) => AbilitySchema.parse({
  id, name, clip: "slam", windup: 0.3, length: 1.2, facing: "lock", start: { min_distance: 0, max_distance: 12, line_of_sight: false, cooldown: 2, weight: 1 },
  stopped_by_hurt: true, hits: [{ type: "area", at: 0.6, shape: { type: "sphere", forward: 2, up: 1, left: 0, radius: 1 }, hits: "target", damage: 1, knockback: 0, effects: [] }], moves: [], events,
})
export const breath = makeMove("breath", "吐出火星", [{ ...burst, bone: "mouth", until: 0.95, every_ticks: 4, velocity: { forward: 9, vary: 0.12 } }, { ...burst, at: 1.05, particle: "crit", count: 1 }])
const slash = makeMove("slash", "横斩", [{ ...burst, at: 0.6, where: "hit", hit: 0, count: 32, velocity: { outward: 6 } }])
export async function createTargetEmitSample(directory: string, target: TargetId, checkInteractions = false) {
  const project = await createProject({ directory, name: "余烬试场", description: "嘴边的火星、横斩的火花、阶段发射和贴地的毒雾。", mod_id: "ember_yard", target })
  const make = (n: number, name: string, extra: object) => EntitySchema.parse({ ...createEntity({ name, description: name, health: 100, speed: 0.2, attack_damage: 3, behavior: "hostile" }), id: id(n), name_en: ["Kiln Sprite", "Steel Watcher", "Furnace Warden"][n - 1], particles: { 火星: { asset: id(4) } }, ...extra })
  const finishParticle = { type: "particle", forward: 0, up: 1, left: 0, spread: 0 }
  const entities = [make(1, "炉口小怪", { abilities: [breath] }), make(2, "钢刃哨兵", { abilities: [slash] }),
    make(3, "熔炉守卫", { ...(checkInteractions ? { steady: { preset: "large" }, stagger: { seconds: 2, damage_scale: 1, at_health: [0.5] } } : {}), abilities: [slash], emitters: [{ particle: "smoke", every_ticks: 6, count: 2, bone: "mouth", velocity: { up: 1 } }, { particle: { alias: "火星" }, bone: "arm_right", every_ticks: 3, count: 5, velocity: { up: 3, outward: 2 }, spread: 0.15, when: { phase: 2 } }, ...(checkInteractions ? [{ particle: "crit", when: "combat", every_ticks: 2, count: 3, bone: "mouth" }] : [])],
      boss: { bar: { color: "red", style: "progress", darken_sky: false }, intro: null, phases: [{ below: 0.5, ...(checkInteractions ? { finish: [{ ...finishParticle, particle: { asset: id(5) }, count: 7 }, { ...finishParticle, particle: { alias: "火星" }, count: 8 }] } : {}), clip: null, seconds: 0.5, bar_color: null, speed: 1, damage: 1 }], death: { seconds: 1, xp_bursts: 0, explosion: false }, leash: null } })]
  const now = new Date().toISOString()
  const asset = (n: number, title: string, module: string, document: object, dependencies: string[] = []) => WorkspaceAssetSchema.parse({ id: id(n), title, module, revision: 1, created_at: now, updated_at: now, prompt: title, dependencies, document, provenance: { model: "example", request_id: null }, status: "ready" })
  const particles = [false, true].map((fog, i) => asset(4+i, fog ? "沼泽薄雾" : "炉火余烬", "particle", { kind: "particle", name: fog ? "marsh_mist" : "kiln_ember", frames: [frame(fog)], frames_by: "age", lifetime: fog ? 2 : 0.8, gravity: 0, size: { start: fog ? 0.8 : 0.15, end: fog ? 1.2 : 0.06 }, color: { start: fog ? "#aaff70" : "#fff687", end: fog ? "#338644" : "#ff6622" }, opacity: { start: 1, end: 0 }, emissive: true, spin: 0 }))
  const trap = asset(6, "毒泡与低雾", "ability", { kind: "ability", name: "毒泡与低雾", english_name: "Marsh Mist", particles: { 毒雾: { asset: id(5) } }, cast: { type: "instant", seconds: 0, cooldown: 1 }, reach: 12, hits: [{ type: "area", at: 0.8, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 3 }, hits: "everyone", damage: 1, knockback: 0, effects: [] }], moves: [], bindings: [{ type: "block", block: "marsh_trap" }],
    events: [{ ...burst, particle: { alias: "毒雾" }, at: 0, up: 1, where: "self", spread: 2, count: 25, motion: { type: "converge" } },
      { ...burst, particle: { alias: "毒雾" }, at: 0.8, until: 2, every_ticks: 3, up: 1.12, where: "self", shape: "disc", count: 60, spread: { forward: 20, up: 0.08, left: 20 }, motion: { type: "orbit", turns: 0.4 } }] }, [id(5)])
  const block = BlockSchema.parse({ id: randomUUID(), identifier: "marsh_trap", name: "沼泽陷阱", name_en: "Marsh Trap", hardness: 2, luminance: 5, tool: "pickaxe", drop: "self", color: "#376540" })
  let saved = await saveProject(directory, { ...project, entities, blocks: [block], workspace: { assets: [...particles, trap] } }, project.revision)
  for (const entity of entities) {
    const design = { ...fightingGolemDesign, bones: [...fightingGolemDesign.bones, { name: "mouth", parent: "head", pivot: [0, 22, -4], rotation: [0,0,0], cubes: [] }] }
    saved = (await putModelAsset(directory, { entity_id: entity.id, data: { design }, origin: "example", expectedRevision: saved.revision })).project
  }
  return saved
}
if (import.meta.main) console.log((await createTargetEmitSample(process.argv[2]!, process.argv[3] as TargetId)).name)

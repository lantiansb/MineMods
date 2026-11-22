import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createDataGameplaySample } from "../script/data-gameplay-sample"
import { reconcile, type Finding } from "../src/reconcile"
import { BossSchema } from "../src/entity-runtime"
import { BlockSwapEventSchema } from "../src/terrain"
import { storeMedia } from "../src/media"
import { saveProject } from "../src/project"
import { WorkspaceAssetSchema } from "../src/workspace"
import { assembleBuildSource } from "../src/build-source"
import { BuildWarningSchema } from "../src/build"
import { oggVorbis } from "./ogg-sample"

import { sharedAbilityIssues, AbilityAssetDocumentSchema } from "../src/ability-asset"
import { fireball } from "../script/target-cast-sample"

test("引用技能里的首领场地会点名生物的招式和技能资产", () => {
  const id = "00000000-0000-4000-8000-000000000001"
  const skill = AbilityAssetDocumentSchema.parse({ ...fireball, events: [{ type: "fog", at: 0 }], bindings: [] })
  const project = { items: [], blocks: [], workspace: { assets: [{ id, document: skill }] }, entities: [{ id: "beast", name: "岩兽", behavior: "hostile", shared_abilities: [{ id: "mist", asset: id, clip: "cast", facing: "lock" as const, stopped_by_hurt: false, start: { min_distance: 0, max_distance: 8, cooldown: 1, line_of_sight: false, weight: 1 } }] }] }
  const [finding] = sharedAbilityIssues(project)
  expect(finding?.text).toContain("岩兽")
  expect(finding?.refs).toEqual([{ kind: "ability", id: "mist", title: skill.name }, { kind: "asset", id, title: skill.name }])
})

type ReferencePolicy = "named" | "context" | "sometimes_named"
const policies = {
  ability_asset: "named",
  ability_bone: "named",
  ability_clip: "named",
  ability_gameplay: "named",
  ability_gap: "named",
  ability_length: "named",
  ability_move: "named",
  ability_parry: "named",
  ability_projectile: "named",
  ability_reach: "named",
  ability_rehit: "named",
  ability_timing: "named",
  ability_trail: "named",
  ability_unused: "named",
  ability_warn: "named",
  ability_windup: "named",
  animation_unplayed: "named",
  animation_later: "named",
  appendage_chain: "named",
  asset_unused: "named",
  blueprint_sound_drift: "named",
  boss_ability: "named",
  boss_arena: "named",
  boss_bar_icon: "named",
  boss_bar_lock_slow: "named",
  boss_bar_missing: "named",
  boss_bar_stages: "named",
  boss_clip: "named",
  boss_clip_length: "named",
  boss_death_clip: "named",
  boss_finish_warning: "named",
  boss_lair_clearance: "named",
  boss_lair_spawns: "named",
  boss_look_bone: "named",
  boss_look_dropped: "named",
  boss_look_glow: "named",
  boss_look_redundant: "named",
  boss_look_texture: "named",
  boss_music: "context",
  boss_shake_cap: "named",
  boss_show_asset: "named",
  boss_show_bone: "named",
  boss_show_clip: "named",
  boss_show_glow: "named",
  boss_show_length: "named",
  boss_show_overlap: "named",
  boss_show_structure: "named",
  boss_unused: "named",
  boss_weather: "named",
  combo_rehit: "named",
  combo_window: "named",
  counter_window: "named",
  creature_unreachable: "named",
  creature_structure: "named",
  spawn_near_small: "named",
  drop_reference: "named",
  effect_alive: "named",
  effect_missing: "named",
  effect_zone: "named",
  english_missing: "named",
  english_text: "named",
  explosion_never: "named",
  facing_lock: "named",
  flight_clip: "named",
  flight_clip_length: "named",
  flight_dive_reach: "named",
  gameplay_unchecked: "named",
  habit_clip: "named",
  hit_feedback: "named",
  language_key: "sometimes_named",
  model_missing: "named",
  model_motions: "named",
  model_pose_advice: "named",
  music_size: "named",
  ore_drops_nothing: "named",
  particle_emission: "named",
  particle_reference: "named",
  particle_mix: "named",
  play_gap: "named",
  play_unreachable: "named",
  recipe_duplicate: "named",
  recipe_reference: "named",
  recipe_vanilla: "named",
  recovery_ratio: "named",
  rule_animation: "named",
  shape_conflict: "named",
  skipped_creature: "named",
  model_only: "named",
  short_visual: "named",
  solid_body_motion: "named",
  blocker_overlap: "named",
  sound_long: "named",
  sound_missing: "named",
  stance_unreachable: "named",
  stance_empty: "named",
  stance_boss_only: "named",
  steady_advice: "context",
  steady_rear_advice: "named",
  steady_counter_circle: "named",
  target_lacks_vanilla: "named",
  terrain_restore: "named",
  texture_missing: "named",
  tier_boss: "context",
  tier_flight: "context",
  tier_limits: "named",
  tier_motions: "named",
  tier_steady: "context",
  windup_sound: "named",
  book_overflow: "named",
  book_image: "named",
  book_image_ratio: "named",
  book_contrast: "named",
  book_frame: "named",
  font_missing: "sometimes_named",
  font_filled: "sometimes_named",
  registry_clash: "named",
  registry_renamed: "named",
} satisfies Record<Finding["rule"], ReferencePolicy>

test("reconciliation carries the IDs of the project objects named in its findings", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "studio-finding-refs-"))
  try {
    const original = await createDataGameplaySample(directory, { life: true, abilities: true, effects: true })
    const entity = original.entities[0]!
    const model = original.workspace.assets.find((asset) => asset.id === entity.id && asset.document.kind === "model")!
    if (model.document.kind !== "model") throw new Error("Missing model in sample")
    const clip = model.document.animations[0]!
    const pose = { ...model.document, look: null, animations: model.document.animations.map((value) =>
      value.name === clip.name ? { ...value, weights: { look: [{ time: 0, value: 0.5 }] } } : value,
    ) }
    const ability = entity.abilities![0]!
    const missing = crypto.randomUUID()
    const particle = { type: "particle" as const, at: 0, particle: "flame" as const, where: "self" as const, count: 4, spread: 1, forward: 0, up: 0, left: 0, tint: "#ffffff" }
    const sound = { type: "sound" as const, at: 0, sound: { asset: missing }, volume: 1, pitch: 1 }
    const music = crypto.randomUUID()
    const terrain = BlockSwapEventSchema.parse({ type: "block_swap", at: 0, where: "self", hit: null, forward: 0, left: 0, block: "minecraft:ice", area: { shape: "circle", radius: 1, height: 1 }, restore_after: 5, only_replace: ["solid"] })
    const boss = BossSchema.parse({
      bar: { color: "red", style: "progress", darken_sky: false }, intro: null,
      phases: [{ below: 0.5, clip: null, seconds: 1, bar_color: null, speed: 1, damage: 1, finish: [{ type: "particle", particle: "flame", count: 4, spread: 1, forward: 0, up: 0, left: 0, tint: "#ffffff" }] }],
      death: { seconds: 2, xp_bursts: 0, explosion: false }, leash: null,
      music: { asset: music, starts: "wake", fade_seconds: 1 },
    })
    const solidBody = { blockers: [{ name: "右栏", forward: 1, up: 1, left: 0, width: 1, height: 1 }], core: { width: 1, height: 2 }, parts: [{ name: "前肩", forward: 1, up: 1, left: 0, width: 1, height: 1, bone: "body", solid: true }] }
    const armed = { ...entity, boss, hitbox: solidBody, abilities: [{ ...ability, events: [...ability.events, particle, sound, terrain] }, ...entity.abilities!.slice(1)] }
    const recipe = original.recipes[0]!
    const copy = { ...recipe, id: crypto.randomUUID(), name: "晶石备用配方" }
    const output = original.blocks.find((block) => recipe.result.endsWith(`:${block.identifier}`))!
    const findings = reconcile({ ...original, entities: [armed], recipes: [...original.recipes, copy] }, {
      animations: { [entity.id]: pose.animations.map(({ name }) => name) },
      models: { [entity.id]: pose },
    })
    const rule = (id: Finding["rule"]) => {
      const found = findings.find((finding) => finding.rule === id)
      expect(found, id).toBeDefined()
      return found!
    }
    const referenced = (finding: Finding, ...ids: (string | number)[]) =>
      expect(finding.refs?.map(({ id }) => id), finding.text).toEqual(expect.arrayContaining(ids))

    const subject = original.workspace.assets.find(({ document }) => document.kind === "entity" && document.model_asset_id === entity.id)!
    const emissions = findings.filter((finding) => finding.rule === "particle_emission")
    referenced(emissions.find((finding) => finding.refs?.some(({ kind }) => kind === "ability"))!, subject.id, ability.id, particle.particle)
    referenced(emissions.find((finding) => finding.text.includes("阶段收尾"))!, subject.id, 2, particle.particle)
    referenced(rule("boss_music"), subject.id, music)
    referenced(rule("blocker_overlap"), subject.id, "右栏", "前肩")
    expect(rule("blocker_overlap").text).toContain("重叠处仍能打中")
    referenced(rule("solid_body_motion"), subject.id, "前肩", "body")
    referenced(rule("terrain_restore"), subject.id, ability.id)
    referenced(rule("sound_missing"), subject.id, ability.id, missing)
    referenced(rule("model_pose_advice"), entity.model_asset_id!, clip.name)
    referenced(rule("recipe_duplicate"), recipe.id, copy.id, output.id)
    const sweep = { ...ability, hits: [{ type: "area" as const, at: 0.7, shape: { type: "arc" as const, angle: 90, reach: 4, low: 0, high: 2 },
      hits: "target" as const, damage: 4, effects: [], knockback: 0 }] }
    const rearSubject = { ...entity, steady: { preset: "huge" as const }, hitbox: { ...entity.hitbox, core: { width: 2, height: 4.5, ...(entity.hitbox?.core.step === undefined ? {} : { step: entity.hitbox.core.step }) } }, abilities: [sweep] }
    const rear = reconcile({ ...original, entities: [rearSubject] }, { animations: { [entity.id]: pose.animations.map(({ name }) => name) } })
      .find(finding => finding.rule === "steady_rear_advice")
    expect(rear?.stops).toBe(false)
    referenced(rear!, subject.id, sweep.id)
    const counter = { ...sweep, on_hurt: { chance: 0.15, cooldown: 8, by: "melee" as const, front_yaw: 75, block: true } }
    const circleSubject = { ...rearSubject, abilities: [counter], boss: { ...boss,
      phases: [{ below: 0.66, clip: null, seconds: 1, bar_color: null, speed: 1, damage: 1,
        abilities: [counter.id], between: { style: "circle" as const, distance: 7, pause: 0.9 } }],
    } }
    const counterAdvice = reconcile({ ...original, entities: [circleSubject] }, { animations: { [entity.id]: pose.animations.map(({ name }) => name) } })
      .filter(finding => finding.rule === "steady_counter_circle")
    expect(counterAdvice).toHaveLength(1)
    expect(counterAdvice[0]!.text).toContain("身体正面挨打时掷概率")
    expect(counterAdvice[0]!.stops).toBe(false)
    referenced(counterAdvice[0]!, subject.id, counter.id, 2)
    const named = [subject, { id: copy.id, title: copy.name }]
    for (const finding of findings) {
      const policy: ReferencePolicy = policies[finding.rule]
      if (policy === "named" || finding.about) expect(finding.refs?.length, finding.text).toBeGreaterThan(0)
      for (const object of named) {
        if (finding.text.includes(`「${object.title}」`)) referenced(finding, object.id)
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("build reconciliation carries the music asset ID through the output warning schema", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "studio-music-refs-"))
  try {
    const directory = path.join(root, "project")
    const project = await createDataGameplaySample(directory)
    const entity = project.entities[0]!
    const sample = oggVorbis({ padding: 8 * 1024 * 1024 })
    const media_sha256 = await storeMedia(directory, sample)
    const now = new Date().toISOString()
    const track = WorkspaceAssetSchema.parse({
      id: crypto.randomUUID(), module: "music", title: "风铃守卫的战曲", revision: 1, created_at: now, updated_at: now,
      prompt: "验证战斗音乐体积提醒", dependencies: [], provenance: { model: "example", request_id: null }, status: "ready",
      document: { kind: "music", name: "wind_chime_march", intro: null, loop: { media_sha256, seconds: 1, channels: 1 }, outro: null },
    })
    const boss = BossSchema.parse({
      bar: { color: "red", style: "progress", darken_sky: false }, intro: null, phases: [],
      death: { seconds: 2, xp_bursts: 0, explosion: false }, leash: null, music: { asset: track.id, starts: "fight", fade_seconds: 1 },
    })
    await saveProject(directory, { ...project, entities: [{ ...entity, boss }], workspace: { assets: [...project.workspace.assets, track] } }, project.revision)
    const generated = await assembleBuildSource(directory, path.join(root, "source"), path.resolve(import.meta.dir, "../../../templates/fabric-1.21"))
    const finding = generated.findings.find(({ rule }) => rule === "music_size")!
    expect(finding?.text).toContain(track.title)
    expect(BuildWarningSchema.parse({ rule: finding.rule, about: null, text: finding.text, fix: finding.fix, refs: finding.refs }).refs)
      .toEqual([{ kind: "asset", id: track.id, title: track.title }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

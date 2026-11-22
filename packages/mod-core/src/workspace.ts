import { z } from "zod"
import { AnimationChannelSchema, ModelDesignSchema, checkAnimationChannels } from "@minemods/studio-ai/contracts"
import { GEOMETRY_TIER_IDS, overBudget, tierOf, TIER_CEILING } from "@minemods/studio-ai/budget"
import { isDeepStrictEqual } from "node:util"
import { shapeConflict } from "@minemods/studio-ai/block-shape"
import { BlockSchema, ContentSchema, ItemSchema, LogicSchema, RecipeSchema, validateContent, type Block, type Content, type Item, type Logic, type Recipe } from "./content"
import type { Project } from "./project"
import { encodePng } from "./png"
import { particleDependencies } from "./particle-emission"
import { CREATURE_LIFE_FIELDS, CreatureSoundsSchema, EntityRuntimeSchema, EntitySchema, creatureDocumentIssues } from "./entity-runtime"
import { creatureTerrainIssues, creatureLairIssues, creatureLootIssues, creatureSummonIssues, creatureTemptIssues } from "./creature-life"
import { recipeClashes, recipeThing } from "./recipe-clash"
import { GestureDocumentSchema } from "./gesture"
import { GameplayDocumentSchema } from "./gameplay"
import { EffectDocumentSchema } from "./effect"
import { MusicDocumentSchema } from "./music"
import { SoundDocumentSchema, creatureSoundIds } from "./sound"
import { abilityEffectIds } from "./effect-abilities"
import { ParticleDocumentSchema } from "./particle"

import { BossBarDocumentSchema, bossBarAsset } from "./boss-bar"
import { FixtureDocumentSchema } from "./fixture"
import { AbilityAssetDocumentSchema, abilityAssetNames } from "./ability-asset"
import { BookDocumentSchema, bookImageIds } from "./book"
import { arenaFixtureIds } from "./arena"
import { bossShowAssets } from "./boss-show"
import { EnglishNameSchema } from "./data-words"
import { RegistryNameSchema, registryClashWords, registryClashes } from "./registry-name"
import { compileItemModel } from "./item-model"

const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const IdentifierSchema = z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/)
const NameSchema = z.string().trim().min(1).max(120)
const DescriptionSchema = z.string().max(4000)
const WireContentId = "00000000-0000-4000-8000-000000000000"

import { assetKind, ModuleKindSchema, savedStatus, type ModuleKind } from "./workspace-modules"
export { ModuleKindSchema, MODULES, type ModuleKind } from "./workspace-modules"

const ModelDocumentSchema = z
  .strictObject({ kind: z.literal("model"), ...ModelDesignSchema.shape })
  .superRefine((document, context) => {
    const { kind: _kind, ...design } = document
    const parsed = ModelDesignSchema.safeParse(design)
    if (!parsed.success) parsed.error.issues.forEach((issue) => context.addIssue({ ...issue, path: ["design", ...issue.path] }))
  })
const TextureDocumentSchema = z
  .strictObject({
    kind: z.literal("texture"),
    // Engineer H2: as large as the largest texture any geometry tier allows; a texture has to be the size of the model it dresses, which is held to its own tier.
    width: z.number().int().min(1).max(TIER_CEILING.texture),
    height: z.number().int().min(1).max(TIER_CEILING.texture),
    palette: z.array(ColorSchema).min(1).max(256),
    pixels: z.array(z.number().int().min(0).max(255)).max(TIER_CEILING.texture ** 2),
  })
  .superRefine((texture, context) => {
    if (texture.pixels.length !== texture.width * texture.height)
      context.addIssue({ code: "custom", path: ["pixels"], message: "Texture pixels must match width × height" })
    if (texture.pixels.some((pixel) => pixel >= texture.palette.length))
      context.addIssue({ code: "custom", path: ["pixels"], message: "Texture pixel references an unknown palette entry" })
  })
// Channels are the model document's own (the animation contract, studio-ai/animation.ts): rotation keys, and optionally position, scale and per-key interpolation.
const AnimationDocumentSchema = z.strictObject({
  kind: z.literal("animation"),
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/),
  length: z.number().finite().positive().max(30),
  loop: z.boolean(),
  // Engineer H2: the array bound is the highest geometry tier's; this document's own tier (absent: the default, 64 bones as before) is checked below and said in words.
  channels: z.array(AnimationChannelSchema).min(1).max(TIER_CEILING.bones),
  budget: z.enum(GEOMETRY_TIER_IDS).nullable().optional(),
}).superRefine((animation, context) => {
  if (animation.channels.length > tierOf(animation.budget).bones) context.addIssue({ code: "custom", path: ["channels"], message: overBudget("bones", animation.channels.length, animation.budget, "这段动作带动的骨骼") })
  checkAnimationChannels(animation.channels, animation.length, (message, path) => context.addIssue({ code: "custom", path: ["channels", ...path], message }))
})

const { id: _blockId, ...blockShape } = BlockSchema.shape
const { id: _itemId, ...itemShape } = ItemSchema.shape
const { id: _recipeId, ...recipeShape } = RecipeSchema.shape
const { id: _logicId, ...logicShape } = LogicSchema.shape
const ContentDocumentSchemas = {
  block: z
    .strictObject({ kind: z.literal("block"), ...blockShape, texture: z.string().max(2_000_000).nullable() })
    .superRefine((document, context) => {
      const conflict = shapeConflict(document)
      if (conflict) context.addIssue({ code: "custom", path: [conflict.field], message: conflict.message })
    }),
  item: z.strictObject({ kind: z.literal("item"), ...itemShape, texture: z.string().max(2_000_000).nullable() }),
  recipe: z
    .strictObject({ kind: z.literal("recipe"), ...recipeShape })
    .superRefine((document, context) => {
      const { kind: _kind, ...content } = document
      const parsed = RecipeSchema.safeParse({ ...content, id: WireContentId })
      if (!parsed.success) parsed.error.issues.forEach((issue) => context.addIssue({ ...issue, path: ["recipe", ...issue.path] }))
    }),
  logic: z
    .strictObject({ kind: z.literal("logic"), ...logicShape, item: z.string().trim().max(120).nullable(), animation: z.string().trim().max(120).nullable() })
    .superRefine((document, context) => {
      const { kind: _kind, ...content } = document
      const parsed = LogicSchema.safeParse({ ...Object.fromEntries(Object.entries(content).filter(([, value]) => value !== null)), id: WireContentId })
      if (!parsed.success) parsed.error.issues.forEach((issue) => context.addIssue({ ...issue, path: ["logic", ...issue.path] }))
    }),
} as const

const WorldviewDocumentSchema = z.strictObject({
  kind: z.literal("worldview"),
  title: NameSchema,
  summary: DescriptionSchema,
  entries: z
    .array(z.strictObject({ title: NameSchema, body: z.string().trim().min(1).max(4000) }))
    .max(128),
})
const BiomeDocumentSchema = z.strictObject({
  kind: z.literal("biome"),
  identifier: IdentifierSchema,
  name: NameSchema,
  description: DescriptionSchema,
  temperature: z.number().finite().min(-10).max(10),
  downfall: z.number().finite().min(0).max(1),
  effects: z.strictObject({ sky: ColorSchema, fog: ColorSchema, water: ColorSchema }),
})
const DimensionDocumentSchema = z.strictObject({
  kind: z.literal("dimension"),
  identifier: IdentifierSchema,
  name: NameSchema,
  description: DescriptionSchema,
  sky: z.enum(["overworld", "nether", "end", "custom"]),
  has_ceiling: z.boolean(),
  ambient_light: z.number().finite().min(0).max(1),
})
const TerrainDocumentSchema = z.strictObject({
  kind: z.literal("terrain"),
  name: NameSchema,
  description: DescriptionSchema,
  layers: z
    .array(z.strictObject({ material: z.string().trim().min(1).max(120), depth: z.number().int().min(1).max(384) }))
    .min(1)
    .max(32),
  features: z.array(z.string().trim().min(1).max(120)).max(64),
})
const EntityDocumentSchema = z.strictObject({
  kind: z.literal("entity"),
  name: NameSchema,
  description: DescriptionSchema,
  health: z.number().finite().positive().max(1024),
  speed: z.number().finite().min(0).max(2),
  attack_damage: z.number().finite().min(0).max(1024),
  behavior: z.enum(["passive", "follow", "hostile"]),
  model_asset_id: z.uuid(),
  runtime: EntityRuntimeSchema,
  sounds: CreatureSoundsSchema.nullable().optional(),
  name_en: EnglishNameSchema.nullable().optional(),
  // r29b: the name the game registers it by; null or absent: `creature_<its id>`, as it always was (`creatureName`).
  identifier: RegistryNameSchema.nullable().optional(),
  ...CREATURE_LIFE_FIELDS,
}).superRefine((entity, context) => creatureDocumentIssues(entity).forEach((issue) => context.addIssue({ code: "custom", ...issue })))

export const ModuleDocumentSchema = z.discriminatedUnion("kind", [
  ModelDocumentSchema,
  TextureDocumentSchema,
  AnimationDocumentSchema,
  EntityDocumentSchema,
  ContentDocumentSchemas.block,
  ContentDocumentSchemas.item,
  ContentDocumentSchemas.recipe,
  ContentDocumentSchemas.logic,
  WorldviewDocumentSchema,
  BiomeDocumentSchema,
  DimensionDocumentSchema,
  TerrainDocumentSchema,
  GestureDocumentSchema,
  GameplayDocumentSchema,
  EffectDocumentSchema,
  SoundDocumentSchema,
  MusicDocumentSchema,
  ParticleDocumentSchema,
  BossBarDocumentSchema,
  FixtureDocumentSchema,
  AbilityAssetDocumentSchema,
  BookDocumentSchema,
])
export type ModuleDocument = z.infer<typeof ModuleDocumentSchema>

export const WorkspaceAssetSchema = z
  .strictObject({
    id: z.uuid(),
    module: ModuleKindSchema,
    title: NameSchema,
    revision: z.number().int().min(1),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    prompt: z.string().trim().min(1).max(20000),
    dependencies: z.array(z.uuid()).max(128),
    document: ModuleDocumentSchema,
    provenance: z.strictObject({ model: z.string().trim().max(120).nullable(), request_id: z.uuid().nullable() }),
    status: z.enum(["ready", "design"]),
  })
  .superRefine((asset, context) => {
    if (asset.module !== asset.document.kind)
      context.addIssue({ code: "custom", path: ["document", "kind"], message: "Module kind and document kind must match" })
  })
export type WorkspaceAsset = z.infer<typeof WorkspaceAssetSchema>

export const WorkspaceSchema = z
  .strictObject({ assets: z.array(WorkspaceAssetSchema).max(4096).default([]) })
  .superRefine((workspace, context) => {
    const ids = new Set<string>()
    workspace.assets.forEach((asset, index) => {
      if (ids.has(asset.id)) context.addIssue({ code: "custom", path: ["assets", index, "id"], message: "Duplicate workspace asset ID" })
      ids.add(asset.id)
    })
    workspace.assets.forEach((asset, index) => {
      const dependencySet = new Set<string>()
      asset.dependencies.forEach((dependency, dependencyIndex) => {
        if (!ids.has(dependency)) context.addIssue({ code: "custom", path: ["assets", index, "dependencies", dependencyIndex], message: `Unknown workspace dependency: ${dependency}` })
        if (dependency === asset.id) context.addIssue({ code: "custom", path: ["assets", index, "dependencies", dependencyIndex], message: "Workspace assets cannot depend on themselves" })
        if (dependencySet.has(dependency)) context.addIssue({ code: "custom", path: ["assets", index, "dependencies", dependencyIndex], message: "Workspace dependencies must be unique" })
        dependencySet.add(dependency)
      })
    })
    // Stays hand-written: the registry lists this reference, but "the block must have a reward pool"
    // is a condition on the target's content that a declarative reference cannot carry.
    workspace.assets.forEach((asset, index) => {
      if (asset.module !== "entity" || asset.document.kind !== "entity") return
      const deathDrop = asset.document.runtime.death_drop
      if (!deathDrop) return
      const block = workspace.assets.find((candidate) => candidate.module === "block" && candidate.document.kind === "block" && candidate.document.identifier === deathDrop.block_identifier && candidate.document.lucky !== null && candidate.document.lucky !== undefined)
      if (!block || !asset.dependencies.includes(block.id))
        context.addIssue({ code: "custom", path: ["assets", index, "dependencies"], message: "Entity asset must depend on its lucky death drop block workspace asset" })
    })
    // References a kind declares as "id" are enforced here from the registry. Only required ones are
    // kind-checked at this level; optional ones are checked when the asset is applied to a project.
    workspace.assets.forEach((asset, index) => {
      const kind = assetKind(asset.module)
      const name = `${asset.module[0]!.toUpperCase()}${asset.module.slice(1)}`
      const links = kind.references
        .filter((reference) => reference.match === "id")
        .flatMap((reference) => {
          const id = reference.field.split(".").reduce<unknown>((value, key) => (typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined), asset.document)
          return typeof id === "string" ? [{ reference, id }] : []
        })
      links.forEach((link) => {
        if (!asset.dependencies.includes(link.id))
          context.addIssue({ code: "custom", path: ["assets", index, "dependencies"], message: `${name} asset must depend on ${link.reference.required ? "its" : "a non-empty"} ${link.reference.kinds.join(" or ")} workspace asset` })
      })
      links.filter((link) => link.reference.required).forEach((link) => {
        const target = workspace.assets.find((candidate) => candidate.id === link.id)
        if (!target || !link.reference.kinds.includes(target.module) || target.document.kind !== target.module)
          context.addIssue({ code: "custom", path: ["assets", index, "document", ...link.reference.field.split(".")], message: `${name} ${link.reference.kinds.join(" or ")} dependency must be a ${link.reference.kinds.join(" or ")} workspace asset` })
      })
      // Not a reference rule: each creature variant needs its own model.
      const document = asset.document
      if (document.kind !== "entity") return
      if (workspace.assets.some((candidate) => {
        if (candidate.id === asset.id || candidate.module !== "entity" || candidate.document.kind !== "entity") return false
        return candidate.document.model_asset_id === document.model_asset_id
      }))
        context.addIssue({ code: "custom", path: ["assets", index, "document", "model_asset_id"], message: "A model workspace asset can only have one entity asset; create a separate model for each variant" })
    })
    // One key plays one gesture; a second gesture on the same key would never be reachable in the game.
    workspace.assets.forEach((asset, index) => {
      const document = asset.document
      if (document.kind !== "gesture") return
      if (workspace.assets.slice(0, index).some((earlier) => earlier.document.kind === "gesture" && earlier.document.trigger.key === document.trigger.key))
        context.addIssue({ code: "custom", path: ["assets", index, "document", "trigger", "key"], message: `Another gesture already uses the ${document.trigger.key} key; pick a different key` })
    })
    // What a gameplay attaches to is a real link: it cannot outlive the thing, and two cannot share a package.
    workspace.assets.forEach((asset, index) => {
      const document = asset.document
      if (document.kind !== "gameplay") return
      if (document.uses.some((id) => !asset.dependencies.includes(id)))
        context.addIssue({ code: "custom", path: ["assets", index, "dependencies"], message: "Gameplay asset must depend on every workspace asset it uses" })
      if (workspace.assets.slice(0, index).some((earlier) => earlier.document.kind === "gameplay" && earlier.document.slug === document.slug))
        context.addIssue({ code: "custom", path: ["assets", index, "document", "slug"], message: `Another gameplay already uses the slug ${document.slug}; pick a different one` })
    })
    // 任务二 §9: a sound of its own a creature plays is a real link too: the creature depends on it, and it is a sound.
    workspace.assets.forEach((asset, index) => {
      const document = asset.document
      if (document.kind !== "entity") return
      const music = document.boss?.music
      if (music && workspace.assets.find(candidate => candidate.id === music.asset)?.document.kind !== "music")
        context.addIssue({ code: "custom", path: ["assets", index, "document", "boss", "music", "asset"], message: "Boss 的音乐在工程里找不到，或这个编号指向了其他种类。请先导入循环段，再选择工程里的音乐资产。" })
      else if (music && !asset.dependencies.includes(music.asset))
        context.addIssue({ code: "custom", path: ["assets", index, "dependencies"], message: "请把这首音乐加进生物的依赖，再保存。" })
      const sounds = [...new Set([...(document.shared_abilities ?? []).flatMap(use => Object.values(use.sounds ?? {}).flatMap(sound => typeof sound === "object" ? [sound.asset] : [])), ...creatureSoundIds({ name: "", builtin:document.builtin, sounds: document.sounds, abilities: document.abilities, boss: document.boss }), ...bossShowAssets(document.behavior === "hostile" ? document.boss : null, document.stances?.list.flatMap(row => row.events ?? [])).sounds])]
      const missing = sounds.filter((id) => workspace.assets.find((candidate) => candidate.id === id)?.document.kind !== "sound")
      if (missing.length) context.addIssue({ code: "custom", path: ["assets", index, "document", "sounds"], message: `「${asset.title}」引用的声音在这个工程里找不到：${missing.join("、")}。先把声音导入这个工程，或者改用工程里已有的声音 UUID 或原版音效。` })
      else if (sounds.some((id) => !asset.dependencies.includes(id))) context.addIssue({ code: "custom", path: ["assets", index, "dependencies"], message: `「${asset.title}」的声音依赖还没登记。重新提交生物任务，Studio 会根据文档自动登记已有声音。` })
    })
    // Two sounds of one project are never registered by the same name.
    workspace.assets.forEach((asset, index) => {
      const document = asset.document
      if (document.kind !== "sound") return
      if (workspace.assets.slice(0, index).some((earlier) => earlier.document.kind === "sound" && earlier.document.name === document.name))
        context.addIssue({ code: "custom", path: ["assets", index, "document", "name"], message: `Another sound already uses the name ${document.name}; pick a different one` })
    })
    // H3: an effect an ability shows is a real link too: the creature depends on it, and it is an effect.
    workspace.assets.forEach((asset, index) => {
      const document = asset.document
      if (document.kind !== "entity") return
      for (const state of ["fixture_lit","fixture_ember"] as const) {
        const id = document.builtin?.[state]?.effect
        if (id && (!asset.dependencies.includes(id) || workspace.assets.find(a => a.id === id)?.document.kind !== "effect"))
          context.addIssue({code:"custom", path:["assets",index,"document","builtin",state,"effect"], message:"请选择工程里的效果，并把它加入这只生物的依赖。"})
      }
      abilityEffectIds(document.abilities).forEach((id) => {
        if (!asset.dependencies.includes(id)) context.addIssue({ code: "custom", path: ["assets", index, "dependencies"], message: "Entity asset must depend on every effect workspace asset its abilities show" })
        if (workspace.assets.find((candidate) => candidate.id === id)?.document.kind !== "effect") context.addIssue({ code: "custom", path: ["assets", index, "document", "abilities"], message: `An ability shows an effect that is not an effect workspace asset: ${id}` })
      })
    })
    // Boss 能力 11: a particle of its own an ability shows is a real link too, as an effect is; and two particles cannot share a name in the game.
    workspace.assets.forEach((asset, index) => {
      const document = asset.document
      if (document.kind === "particle" && workspace.assets.slice(0, index).some((earlier) => earlier.document.kind === "particle" && earlier.document.name === document.name))
        context.addIssue({ code: "custom", path: ["assets", index, "document", "name"], message: `Another particle already uses the name ${document.name}; pick a different one` })
      if (document.kind !== "entity") return
      particleDependencies(document).forEach((id) => {
        if (!asset.dependencies.includes(id)) context.addIssue({ code: "custom", path: ["assets", index, "dependencies"], message: "Entity asset must depend on every particle workspace asset its abilities show" })
        if (workspace.assets.find((candidate) => candidate.id === id)?.document.kind !== "particle") context.addIssue({ code: "custom", path: ["assets", index, "document", "abilities"], message: `An ability shows a particle that is not a particle workspace asset: ${id}` })
      })
    })
    // Boss 能力 15: a sound, an effect or a particle of its own a boss's wake-up or death plays is a real link too, as an ability's is.
    workspace.assets.forEach((asset, index) => {
      const document = asset.document
      if (document.kind !== "entity") return
      const used = bossShowAssets(document.behavior === "hostile" ? document.boss : null, document.stances?.list.flatMap(row => row.events ?? []))
      for (const [kind, ids] of [["effect", used.effects], ["particle", used.particles]] as const)
        for (const id of ids) {
          if (!asset.dependencies.includes(id)) context.addIssue({ code: "custom", path: ["assets", index, "dependencies"], message: `Entity asset must depend on every ${kind} workspace asset its boss's shows use` })
          if (workspace.assets.find((candidate) => candidate.id === id)?.document.kind !== kind) context.addIssue({ code: "custom", path: ["assets", index, "document", "boss"], message: `A boss's show uses a ${kind} that is not a ${kind} workspace asset: ${id}` })
        }
    })
    // Boss 能力 6: the bar a boss names is a bar (the dependency itself is the registry's "id" reference, checked above).
    workspace.assets.forEach((asset, index) => {
      const document = asset.document
      const bar = document.kind === "entity" ? bossBarAsset(document.boss) : null
      if (bar && workspace.assets.find((candidate) => candidate.id === bar)?.document.kind !== "bossbar") context.addIssue({ code: "custom", path: ["assets", index, "document", "boss", "bar", "look", "asset"], message: `A boss bar look must be a bossbar workspace asset: ${bar}` })
    })
    // Boss 能力 12: a fixture a boss's arena puts down is a real link, as an effect is: the creature depends on it, and it is a fixture.
    workspace.assets.forEach((asset, index) => {
      const document = asset.document
      if (document.kind !== "entity") return
      arenaFixtureIds(document.boss).forEach((id) => {
        if (!asset.dependencies.includes(id)) context.addIssue({ code: "custom", path: ["assets", index, "dependencies"], message: "Entity asset must depend on every fixture workspace asset its boss's arena puts down" })
        if (workspace.assets.find((candidate) => candidate.id === id)?.document.kind !== "fixture") context.addIssue({ code: "custom", path: ["assets", index, "document", "boss", "arena", "fixtures"], message: `An arena fixture's look must be a fixture workspace asset: ${id}` })
      })
    })
    // 技能资产: the ability assets a creature uses are real links (it depends on each, and each is an ability); and what an ability names (its effects, sounds and cast actions) is too.
    workspace.assets.forEach((asset, index) => {
      const document = asset.document
      if (document.kind === "entity")
        (document.shared_abilities ?? []).forEach((use, at) => {
          if (!asset.dependencies.includes(use.asset)) context.addIssue({ code: "custom", path: ["assets", index, "dependencies"], message: "Entity asset must depend on every ability workspace asset it uses" })
          if (workspace.assets.find((candidate) => candidate.id === use.asset)?.document.kind !== "ability") context.addIssue({ code: "custom", path: ["assets", index, "document", "shared_abilities", at, "asset"], message: `A creature uses an ability that is not an ability workspace asset: ${use.asset}` })
        })
      if (document.kind !== "ability") return
      const named = abilityAssetNames(document)
      for (const [kind, ids] of [["effect", named.effects], ["sound", named.sounds], ["gesture", named.gestures], ["particle", named.particles]] as const)
        for (const id of ids) {
          if (!asset.dependencies.includes(id)) context.addIssue({ code: "custom", path: ["assets", index, "dependencies"], message: `Ability asset must depend on every ${kind} workspace asset it names` })
          if (workspace.assets.find((candidate) => candidate.id === id)?.document.kind !== kind) context.addIssue({ code: "custom", path: ["assets", index, "document"], message: `An ability names a ${kind} that is not a ${kind} workspace asset: ${id}` })
        }
    })
    // 书: a picture a page shows is a real link too: the book depends on it, and it is a texture.
    workspace.assets.forEach((asset, index) => {
      const document = asset.document
      if (document.kind !== "book") return
      for (const id of bookImageIds(document)) {
        if (!asset.dependencies.includes(id)) context.addIssue({ code: "custom", path: ["assets", index, "dependencies"], message: "书页上的图和书的外观用到的图要加进这本书的依赖（dependencies）。" })
        if (workspace.assets.find((candidate) => candidate.id === id)?.document.kind !== "texture") context.addIssue({ code: "custom", path: ["assets", index, "document", "pages"], message: `书用到的图要是工程里的一张贴图（texture）：${id} 不是。` })
      }
    })
    const graph = new Map(workspace.assets.map((asset) => [asset.id, asset.dependencies]))
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (id: string): void => {
      if (visiting.has(id)) {
        context.addIssue({ code: "custom", path: ["assets"], message: "Workspace dependencies must be acyclic" })
        return
      }
      if (visited.has(id)) return
      visiting.add(id)
      graph.get(id)?.forEach(visit)
      visiting.delete(id)
      visited.add(id)
    }
    workspace.assets.forEach((asset) => visit(asset.id))
  })
export type Workspace = z.infer<typeof WorkspaceSchema>

const moduleSchemas = {
  model: ModelDocumentSchema,
  texture: TextureDocumentSchema,
  animation: AnimationDocumentSchema,
  entity: EntityDocumentSchema,
  ...ContentDocumentSchemas,
  worldview: WorldviewDocumentSchema,
  biome: BiomeDocumentSchema,
  dimension: DimensionDocumentSchema,
  terrain: TerrainDocumentSchema,
  gesture: GestureDocumentSchema,
  gameplay: GameplayDocumentSchema,
  effect: EffectDocumentSchema,
  sound: SoundDocumentSchema,
  music: MusicDocumentSchema,
  particle: ParticleDocumentSchema,
  bossbar: BossBarDocumentSchema,
  fixture: FixtureDocumentSchema,
  ability: AbilityAssetDocumentSchema,
  book: BookDocumentSchema,
} as const

export function getModuleSchema(kind: ModuleKind) {
  return moduleSchemas[ModuleKindSchema.parse(kind)]
}

export function compileWorkspaceTexture(input: WorkspaceAsset | ModuleDocument) {
  const document = typeof input === "object" && input !== null && "document" in input
    ? WorkspaceAssetSchema.parse(input).document
    : ModuleDocumentSchema.parse(input)
  if (document.kind !== "texture") throw new Error("Texture export requires a texture workspace asset")
  const rgba = new Uint8Array(document.pixels.length * 4)
  document.pixels.forEach((paletteIndex, index) => {
    const color = document.palette[paletteIndex]!
    rgba[index * 4] = Number.parseInt(color.slice(1, 3), 16)
    rgba[index * 4 + 1] = Number.parseInt(color.slice(3, 5), 16)
    rgba[index * 4 + 2] = Number.parseInt(color.slice(5, 7), 16)
    rgba[index * 4 + 3] = 255
  })
  return encodePng(rgba, document.width, document.height)
}

function readyItemModels(workspace: Workspace, items: { model_asset_id?: string | null }[]): Workspace {
  const ids = new Set(items.flatMap(item => item.model_asset_id ? [item.model_asset_id] : []))
  ids.forEach(id => {
    const asset = workspace.assets.find(value => value.id === id)
    if (asset?.document.kind !== "model") throw new Error(`物品引用的模型不存在：${id}`)
    const { kind: _kind, ...design } = asset.document
    compileItemModel(design)
  })
  return { assets: workspace.assets.map(asset => ids.has(asset.id) ? { ...asset, status: "ready" as const } : asset) }
}

export async function removeWorkspaceAsset(project:Project,id:string):Promise<Project> {
  const {ProjectSchema}=await import("./project")
  const asset=project.workspace.assets.find(a=>a.id===id)
  if(!asset) throw new Error("找不到这样东西。")
  if(asset.module === "entity" || project.entities.some(e=>e.id===id)) throw new Error("生物与模型、行为和游戏存档相连，这一版还不能删除。")
  const entries=project.blueprint?.entries??[]
  const keys=new Set(entries.filter(e=>e.asset_id===id).map(e=>e.key))
  const users=[...project.workspace.assets.filter(a=>a.id!==id && a.dependencies.includes(id)).map(a=>a.title),...entries.filter(e=>!keys.has(e.key) && ((e.owner && keys.has(e.owner)) || e.needs.some(k=>keys.has(k)))).map(e=>e.title)]
  if(users.length) throw new Error("还不能删，以下内容在用它："+users.join("、"))
  const keep=<T extends {id:string}>(items:T[])=>items.filter(x=>x.id!==id)
  const next={...project,workspace:{assets:keep(project.workspace.assets)},blocks:keep(project.blocks),items:keep(project.items),recipes:keep(project.recipes),logic:keep(project.logic)}
  if(next.blueprint) next.blueprint={...next.blueprint,entries:entries.filter(e=>!keys.has(e.key))}
  validateContent(next)
  return ProjectSchema.parse(next)
}

export function applyWorkspaceAsset(project: Project, input: WorkspaceAsset): Project {
  const asset = WorkspaceAssetSchema.parse(input)
  const current = project.workspace?.assets.find((value) => value.id === asset.id)
  if (current && current.module !== asset.module) throw new Error("Workspace asset module cannot change")
  if (asset.module === "texture" && asset.document.kind === "texture") {
    const textureDocument = asset.document
    project.workspace.assets.forEach((candidate) => {
      if (candidate.module !== "entity") return
      const candidateDocument = candidate.document
      if (candidateDocument.kind !== "entity" || candidateDocument.runtime.texture_asset_id !== asset.id) return
      const model = project.workspace.assets.find((value) => value.id === candidateDocument.model_asset_id)
      if (model?.module === "model" && model.document.kind === "model" && (textureDocument.width !== model.document.texture_size || textureDocument.height !== model.document.texture_size))
        throw new Error("Texture dimensions must match the model used by an existing entity binding")
    })
  }
  if (asset.module === "model" && asset.document.kind === "model") {
    const modelDocument = asset.document
    project.workspace.assets.forEach((candidate) => {
      if (candidate.module !== "entity") return
      const candidateDocument = candidate.document
      if (candidateDocument.kind !== "entity" || candidateDocument.model_asset_id !== asset.id || candidateDocument.runtime.texture_asset_id === null) return
      const texture = project.workspace.assets.find((value) => value.id === candidateDocument.runtime.texture_asset_id)
      if (texture?.module === "texture" && texture.document.kind === "texture" && (texture.document.width !== modelDocument.texture_size || texture.document.height !== modelDocument.texture_size))
        throw new Error("Model texture size cannot change while an entity texture binding would become incompatible")
    })
  }
  const staged = assetKind(asset.module).staged && asset.status === "ready"
    ? { ...asset, status: "design" as const }
    : asset
  const workspace = readyItemModels(WorkspaceSchema.parse({ assets: [...(project.workspace?.assets ?? []).filter((value) => value.id !== staged.id), staged] }), staged.document.kind === "item" ? [...project.items.filter(item => item.id !== staged.id), staged.document] : project.items)
  const next = { ...project, workspace }
  if (staged.module === "entity") {
    if (staged.document.kind !== "entity") throw new Error("Entity workspace asset requires an entity document")
    const document = staged.document
    if (!staged.dependencies.includes(document.model_asset_id)) throw new Error("Entity asset must depend on its model workspace asset")
    const textureId = document.runtime.texture_asset_id
    if (textureId !== null && !staged.dependencies.includes(textureId)) throw new Error("Entity asset must depend on a non-empty texture workspace asset")
    const model = workspace.assets.find((candidate) => candidate.id === document.model_asset_id)
    if (!model || model.module !== "model" || model.document.kind !== "model" || model.status !== "ready") throw new Error("Entity model workspace asset must be ready")
    const bridgedEntity = next.entities.find((entity) => entity.id === model.id)
    if (!bridgedEntity) throw new Error("Entity model workspace asset has no persisted entity")
    if (textureId !== null) {
      const texture = workspace.assets.find((candidate) => candidate.id === textureId)
      if (!texture || texture.module !== "texture" || texture.document.kind !== "texture") throw new Error("Entity texture dependency must be a texture workspace asset")
      if (texture.document.width !== model.document.texture_size || texture.document.height !== model.document.texture_size)
        throw new Error("Entity texture dimensions must match the model texture size")
    }
    // A drop that names nothing of this project would leave the creature's whole loot table unreadable in the game; a lair's floor, the same.
    const lost = creatureTerrainIssues(next, document)[0] ?? creatureLootIssues(next, document)[0] ?? creatureTemptIssues(next, document)[0] ?? creatureLairIssues(next, document)[0] ?? creatureSummonIssues(next, document)[0]
    if (lost) throw new Error(lost)
    const { kind: _kind, model_asset_id: _workspaceModelAssetId, ...entityFields } = document
    // r29b: a name taken off the document is taken off the creature too, so it is registered as `creature_<its id>` again.
    return registryChecked({
      ...next,
      entities: next.entities.map((entity) => entity.id === bridgedEntity.id ? EntitySchema.parse({ ...entity, ...(entity.steady && !document.steady ? { steady: null } : {}), ...(entity.builtin && !document.builtin ? { builtin: undefined } : {}), ...(entity.identifier && !document.identifier ? { identifier: null } : {}), ...entityFields, model_asset_id: entity.model_asset_id }) : entity),
    }, bridgedEntity.id)
  }
  if (staged.module === "animation") {
    const model = staged.dependencies.map((dependency) => workspace.assets.find((candidate) => candidate.id === dependency)).find((candidate) => candidate?.module === "model")
    if (staged.document.kind === "animation" && model?.document.kind === "model") {
      const bones = new Set(model.document.bones.map((bone) => bone.name))
      staged.document.channels.forEach((channel) => {
        if (!bones.has(channel.bone)) throw new Error(`Animation bone does not exist: ${channel.bone}`)
      })
    }
  }
  if (staged.module === "model" || staged.module === "texture" || staged.module === "animation" || staged.module === "worldview" || staged.module === "biome" || staged.module === "dimension" || staged.module === "terrain" || staged.module === "gesture" || staged.module === "gameplay" || staged.module === "effect" || staged.module === "sound" || staged.module === "music" || staged.module === "particle" || staged.module === "bossbar" || staged.module === "fixture" || staged.module === "ability") return next
  if (staged.module === "book") return registryChecked(next, staged.id)
  const document = { ...staged.document }
  delete (document as { kind?: ModuleKind }).kind
  const content = { blocks: next.blocks, items: next.items, recipes: next.recipes, logic: next.logic }
  if (staged.module === "block") content.blocks = [...content.blocks.filter((value) => value.id !== staged.id), BlockSchema.parse({ ...document, id: staged.id, ...(staged.document.kind === "block" && staged.document.texture === null ? { texture: undefined } : {}) }) as Block]
  if (staged.module === "item") content.items = [...content.items.filter((value) => value.id !== staged.id), ItemSchema.parse({ ...document, id: staged.id, ...(staged.document.kind === "item" && staged.document.texture === null ? { texture: undefined } : {}) }) as Item]
  if (staged.module === "recipe") content.recipes = [...content.recipes.filter((value) => value.id !== staged.id), RecipeSchema.parse({ ...document, id: staged.id }) as Recipe]
  if (staged.module === "logic") content.logic = [...content.logic.filter((value) => value.id !== staged.id), LogicSchema.parse({ ...Object.fromEntries(Object.entries(document).filter(([, value]) => value !== null)), id: staged.id }) as Logic]
  validateContent({ ...content, mod_id: next.mod_id, entities: next.entities })
  // A crafting recipe that takes what a recipe of the game takes (or another of this project's, to the same end) is never the one that is made.
  if (staged.module === "recipe") {
    const saved = content.recipes.find((value) => value.id === staged.id)!
    const clash = recipeClashes(saved, content.recipes, (reference) => recipeThing({ mod_id: next.mod_id, blocks: content.blocks, items: content.items }, reference)).find((found) => found.stops)
    if (clash) throw new Error(`${clash.text}${clash.fix}`)
  }
  return staged.module === "block" || staged.module === "item" ? registryChecked({ ...next, ...content }, staged.id) : { ...next, ...content }
}

/** r29b: a creature or a book that names itself may not take a name the mod already gives something else, nor anything else a name such a one took; said as the build says it. */
function registryChecked<T extends Project>(project: T, id: string): T {
  const clashes = registryClashes(project)
  const clash = clashes.find((found) => found.id === id) ?? clashes.find((found) => found.other.id === id)
  if (!clash) return project
  const words = registryClashWords(project.mod_id, clash)
  throw new Error(`${words.text}${words.fix}`)
}

/** Each content record written the way its workspace asset stores it; `document` is null when it cannot be stored. */
function contentEntries(content: Content) {
  return [
    ...content.blocks.map((value) => ({ module: "block" as const, value, title: value.name, document: { ...value, kind: "block", texture: value.texture ?? null } })),
    ...content.items.map((value) => ({ module: "item" as const, value, title: value.name, document: { ...value, kind: "item", texture: value.texture ?? null } })),
    ...content.recipes.map((value) => ({ module: "recipe" as const, value, title: value.name, document: { ...value, kind: "recipe" } })),
    ...content.logic.map((value) => ({ module: "logic" as const, value, title: assetKind("logic").label, document: { ...value, kind: "logic", item: value.item ?? null, animation: value.animation ?? null } })),
  ].map((entry) => {
    const { id: _id, ...fields } = entry.document
    return { id: entry.value.id, module: entry.module, title: entry.title, document: ModuleDocumentSchema.safeParse(fields).data ?? null }
  })
}

/**
 * Replace the project's blocks, items, recipes and logic with an edited set, and keep the workspace
 * assets describing them in step: the build reads the content lists, everything else reads the assets.
 */
export function applyContent(project: Project, input: Content): Project {
  const content = ContentSchema.parse(input)
  // The same reference rules as content saved through an asset: a recipe naming something that is not there is not ready.
  validateContent({ ...content, mod_id: project.mod_id, entities: project.entities })
  const timestamp = new Date().toISOString()
  const entries = contentEntries(content).map((entry) => {
    // Only an oversized picture can fit the content lists yet not a workspace document.
    if (!entry.document) throw new Error(`Content texture is too large to store as a workspace asset: ${entry.title}`)
    return { ...entry, document: entry.document }
  })
  const mirrored = new Set<ModuleKind>(["block", "item", "recipe", "logic"])
  const removed = new Set(
    project.workspace.assets.filter((asset) => mirrored.has(asset.module) && !entries.some((entry) => entry.id === asset.id)).map((asset) => asset.id),
  )
  const kept = project.workspace.assets
    .filter((asset) => !removed.has(asset.id))
    .map((asset) => {
      const entry = entries.find((value) => value.id === asset.id)
      const dependencies = [...new Set([
        ...asset.dependencies.filter((dependency) => !removed.has(dependency) && !(asset.document.kind === "item" && dependency === asset.document.model_asset_id)),
        ...(entry?.document.kind === "item" && entry.document.model_asset_id ? [entry.document.model_asset_id] : []),
      ])]
      if (!entry) return { ...asset, dependencies }
      if (entry.module !== asset.module) throw new Error("Workspace asset module cannot change")
      if (isDeepStrictEqual(asset.document, entry.document)) return { ...asset, dependencies }
      // The name typed in the editor is the name in the game, so the asset is listed under it too.
      return { ...asset, dependencies, title: entry.title, document: entry.document, revision: asset.revision + 1, updated_at: timestamp }
    })
  const created = entries
    .filter((entry) => !project.workspace.assets.some((asset) => asset.id === entry.id))
    .map((entry) => ({
      ...entry,
      revision: 1,
      created_at: timestamp,
      updated_at: timestamp,
      prompt: "在内容编辑器里手动编辑",
      dependencies: entry.document.kind === "item" && entry.document.model_asset_id ? [entry.document.model_asset_id] : [],
      provenance: { model: null, request_id: null },
      status: savedStatus(entry.module, project.target),
    }))
  return {
    ...project,
    ...content,
    workspace: readyItemModels(WorkspaceSchema.parse({ assets: [...kept, ...created] }), content.items),
    // A plan entry must not keep pointing at something the person has just deleted.
    ...(project.blueprint
      ? { blueprint: { ...project.blueprint, entries: project.blueprint.entries.map((entry) => (entry.asset_id && removed.has(entry.asset_id) ? { ...entry, asset_id: null } : entry)) } }
      : {}),
  }
}

/**
 * Give the blocks, items, recipes and logic named in `ids` the workspace asset that stands for them, when they have none yet. Content
 * made by hand before assets were kept in step (or in a project that never went through the content editor) exists only in the content
 * lists; a task that changes it needs an asset to edit in place, and the asset must be the very content (same id, same document), so
 * saving the task replaces that content and no second one appears. Nothing else is touched: unlike `applyContent` it never bumps the
 * revision of an asset that differs from its content.
 */
export function mirrorContent(project: Project, ids: ReadonlySet<string>): Project {
  const timestamp = new Date().toISOString()
  const missing = contentEntries({ blocks: project.blocks, items: project.items, recipes: project.recipes, logic: project.logic }).filter(
    (entry) => ids.has(entry.id) && !project.workspace.assets.some((asset) => asset.id === entry.id),
  )
  if (!missing.length) return project
  const created = missing.map((entry) => {
    if (!entry.document) throw new Error(`Content texture is too large to store as a workspace asset: ${entry.title}`)
    return {
      id: entry.id,
      module: entry.module,
      title: entry.title,
      document: entry.document,
      revision: 1,
      created_at: timestamp,
      updated_at: timestamp,
      prompt: "手动做的内容，由 AI 在它现在的样子上修改",
      dependencies: [],
      provenance: { model: null, request_id: null },
      status: savedStatus(entry.module, project.target),
    }
  })
  return { ...project, workspace: WorkspaceSchema.parse({ assets: [...project.workspace.assets, ...created] }) }
}

/**
 * The workspace assets whose current revision is exactly what a build of this project compiles.
 * Never throws: it runs inside every build, including builds of projects saved by older versions.
 */
export function builtWorkspaceAssets(project: Project) {
  const content = contentEntries({ blocks: project.blocks, items: project.items, recipes: project.recipes, logic: project.logic })
  return project.workspace.assets
    .filter((asset) => {
      const document = asset.document
      if (document.kind === "model") return project.items.some(item => item.model_asset_id === asset.id) || project.entities.some((entity) => entity.id === asset.id && entity.model_asset_id !== null)
      if (document.kind === "entity") return project.entities.some((entity) => entity.id === document.model_asset_id && entity.model_asset_id !== null)
      // 书: and the pictures a saved book's pages show.
      if (document.kind === "texture") return project.entities.some((entity) => entity.runtime?.texture_asset_id === asset.id) || project.workspace.assets.some((book) => book.document.kind === "book" && bookImageIds(book.document).includes(asset.id))
      // 书: every saved book is built into the mod.
      if (document.kind === "book") return true
      // Every saved gesture is compiled; nothing else has to bind it.
      if (document.kind === "gesture") return true
      // So is every saved gameplay: its sources go into the mod as they are.
      if (document.kind === "gameplay") return true
      // And every saved effect: its model and its row in the effect tables go into the mod.
      if (document.kind === "effect") return true
      // And every saved sound (任务二 §9): it is registered and its files go into the mod.
      if (document.kind === "music") return project.entities.some(entity => entity.behavior === "hostile" && entity.boss?.music?.asset === asset.id)
      if (document.kind === "sound") return true
      // And every saved particle: its pictures, its description and its row of the particle table.
      if (document.kind === "particle") return true
      // Boss 能力 6: a bar goes into the mod (its pictures and a layout per boss) once a boss shows it.
      if (document.kind === "bossbar") return project.entities.some((entity) => bossBarAsset(entity.boss) === asset.id)
      // Boss 能力 12: a fixture goes into the mod (its model, motions and row of the fixture table) once a boss's arena puts it down.
      if (document.kind === "fixture") return project.entities.some((entity) => arenaFixtureIds(entity.boss).includes(asset.id))
      // 技能资产: an ability goes into the mod once it is bound to an item, a block or a cast action, or a creature uses it.
      // (`?? []`: this never throws, also over a document saved by hand without the list.)
      if (document.kind === "ability") return (document.bindings ?? []).length > 0 || project.entities.some((entity) => (entity.shared_abilities ?? []).some((use) => use.asset === asset.id))
      // Content edited before the two stores were kept in step may differ from its asset; such an asset is not what gets built.
      return content.some((entry) => entry.id === asset.id && entry.module === asset.module && isDeepStrictEqual(entry.document, document))
    })
    .map((asset) => ({ id: asset.id, module: asset.module, revision: asset.revision }))
}

/**
 * What the project holds that a build leaves out: the saved things "only a design draft" in the build panel means, worked out from what a build
 * really compiles (`builtWorkspaceAssets`, the very list a pack writes into its manifest) and not from the `status` an asset was saved with.
 * That status is set once, at the first save, by the kind alone: a texture a creature wears is compiled into the mod and still says "design",
 * and a kind that is compiled but waits on a binding says it until something rewrites it. The standard is the same for every kind: a saved asset
 * the build does not take is a draft, and one it takes is not, whatever its status says.
 * Older conception entries (design text, not assets) count too, unless the thing they describe is in the project and built under the same id.
 */
export function unbuiltThings(project: Project): { id: string; kind: string; title: string }[] {
  const built = new Set(builtWorkspaceAssets(project).map((asset) => asset.id))
  const content = new Set(contentEntries({ blocks: project.blocks, items: project.items, recipes: project.recipes, logic: project.logic }).map((entry) => entry.id))
  const assets = project.workspace.assets.filter((asset) => !built.has(asset.id)).map((asset) => ({ id: asset.id, kind: asset.module as string, title: asset.title }))
  const held = new Set(project.workspace.assets.map((asset) => asset.id))
  const notes = project.conception.entries
    .filter((entry) => entry.kind !== "entity" && !held.has(entry.id) && !content.has(entry.id))
    .map((entry) => ({ id: entry.id, kind: entry.kind as string, title: entry.title }))
  return [...assets, ...notes]
}

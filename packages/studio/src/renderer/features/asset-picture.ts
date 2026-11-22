import { audioWave } from "./audio-wave"
import { fixtureModel } from "@minemods/mod-core/fixture"
import { particleImage } from "./particle-image"
import type { Project } from "@minemods/mod-core/project"
import { GestureDocumentSchema, gestureFirstPersonPreview, gesturePlayerPreview } from "@minemods/mod-core/gesture"
import { GESTURE_TICK } from "@minemods/mod-core/gesture-rig"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { OverviewItem } from "../../api"
import type { Preview } from "../viewport"
import itemNames from "../assets/minecraft/1.21.1/item-names.json"
import { gameplaySign } from "./asset-gameplay-sign"
import { snapshotModel } from "./imported-asset-media"
import { effectShot } from "../look-camera"
import { BlockShapeSchema, blockPaint, type BlockShape } from "@minemods/studio-ai/block-shape"
import { SHAPE_VIEWS, drawShape } from "@minemods/studio-ai/block-shape-facts"
import { effectModel } from "@minemods/mod-core/effect"
import { bossBarLayout, drawBossBar, evenLines, type BossBarDocument } from "@minemods/mod-core/boss-bar"
import { referenceWords } from "@minemods/mod-core/content-words"

export type Asset = Project["workspace"]["assets"][number]
type Texture = Extract<Asset["document"], { kind: "texture" }>
type Tile = Pick<OverviewItem, "id" | "asset_id" | "kind" | "preview">
/** Where a model to draw is found; the overview hands these out per item, so nothing is guessed here. */
export type Source = Pick<OverviewItem["preview"], "model_asset_id" | "texture_asset_id" | "entity_id">
/** Whatever a recipe, a drop or a rule names: something of this mod, or something from the game itself. */
export type Named = { name: string; item: string | null; picture: Picture | null }
/** A picture that can be made later: `key` changes whenever what it shows changes. */
export type Picture = { key: string; pixel: boolean; load: () => Promise<string | null> }
/** What an outside AI has shown of a thing it is still making. Never saved, so never judged. */
export type Draft = { kind: string; title: string; asset_id: string | null; document: unknown; progress: number | null }
export type Look = { model: ModelDesign; preview: Preview | null; texture: string | null }

// The game pictures shipped with the app. Anything else from the game is shown by its name.
const vanilla: Record<string, { url: string; block?: boolean }> = {
  "minecraft:copper_ingot": { url: new URL("../assets/minecraft/1.21.1/item/copper_ingot.png", import.meta.url).href },
  "minecraft:redstone": { url: new URL("../assets/minecraft/1.21.1/item/redstone.png", import.meta.url).href },
  "minecraft:iron_ingot": { url: new URL("../assets/minecraft/1.21.1/item/iron_ingot.png", import.meta.url).href },
  "minecraft:gold_ingot": { url: new URL("../assets/minecraft/1.21.1/item/gold_ingot.png", import.meta.url).href },
  "minecraft:diamond": { url: new URL("../assets/minecraft/1.21.1/item/diamond.png", import.meta.url).href },
  "minecraft:stick": { url: new URL("../assets/minecraft/1.21.1/item/stick.png", import.meta.url).href },
  "minecraft:coal": { url: new URL("../assets/minecraft/1.21.1/item/coal.png", import.meta.url).href },
  "minecraft:oak_planks": { url: new URL("../assets/minecraft/1.21.1/block/oak_planks.png", import.meta.url).href, block: true },
  "minecraft:cobblestone": { url: new URL("../assets/minecraft/1.21.1/block/cobblestone.png", import.meta.url).href, block: true },
  "minecraft:glass": { url: new URL("../assets/minecraft/1.21.1/block/glass.png", import.meta.url).href, block: true },
}

const cache = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()
const looks = new Map<string, Promise<Look | null>>()
const sheets = new WeakMap<object, string>()
// A page of two hundred tiles asks for its pictures a few at a time, so scrolling and clicking stay smooth.
const gate = { busy: 0, waiting: [] as (() => void)[] }

/** The picture if it was already made; undefined when it still has to be. */
export function cachedPicture(key: string) {
  return cache.get(key)
}

/** Make a picture once per key. Old ones are dropped first when there are very many. */
export function loadPicture(picture: Picture, queued = true) {
  if (cache.has(picture.key)) return Promise.resolve(cache.get(picture.key) ?? null)
  const waiting = pending.get(picture.key)
  if (waiting) return waiting
  const work = (queued && gate.busy >= 3 ? new Promise<void>((resolve) => gate.waiting.push(resolve)) : Promise.resolve())
    .then(() => {
      if (queued) gate.busy++
      return picture.load()
    })
    .then(
      (url) => ({ url, keep: true }),
      // A picture that could not be made is not remembered, so the next tile that wants it asks again.
      () => ({ url: null, keep: false }),
    )
    .then((made) => {
      if (queued) gate.busy--
      if (queued) gate.waiting.shift()?.()
      if (made.keep) cache.set(picture.key, made.url)
      if (cache.size > 800) cache.delete(cache.keys().next().value!)
      pending.delete(picture.key)
      return made.url
    })
  pending.set(picture.key, work)
  return work
}

/** A texture asset drawn pixel for pixel. */
export function textureUrl(texture: Texture) {
  const known = sheets.get(texture)
  if (known) return known
  const canvas = document.createElement("canvas")
  canvas.width = texture.width
  canvas.height = texture.height
  const context = canvas.getContext("2d")
  if (!context) return ""
  const image = context.createImageData(texture.width, texture.height)
  const palette = texture.palette.map((color) => [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16)))
  texture.pixels.forEach((entry, index) => image.data.set([...(palette[entry] ?? [0, 0, 0]), 255], index * 4))
  context.putImageData(image, 0, 0)
  const url = canvas.toDataURL("image/png")
  sheets.set(texture, url)
  return url
}

async function image(source: string) {
  const picture = new Image()
  picture.src = source
  await picture.decode()
  return picture
}

/** A block the way an inventory shows it: three faces of a cube, from its texture or its plain colour. */
async function cube(color: string, texture?: string | null) {
  const face = texture ? await image(texture).catch(() => null) : null
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 128
  const context = canvas.getContext("2d")
  if (!context) return null
  context.imageSmoothingEnabled = false
  // Each face is drawn on its own layer, so its shading never darkens the see-through parts of a texture.
  const side = (origin: [number, number], u: [number, number], v: [number, number], shade: number) => {
    const layer = document.createElement("canvas")
    layer.width = layer.height = 128
    const own = layer.getContext("2d")
    if (!own) return
    own.imageSmoothingEnabled = false
    own.setTransform(u[0] / 8, u[1] / 8, v[0] / 8, v[1] / 8, origin[0] * 2, origin[1] * 2)
    own.fillStyle = color
    if (!face) own.fillRect(0, 0, 16, 16)
    if (face) own.drawImage(face, 0, 0, face.width, Math.min(face.height, face.width), 0, 0, 16, 16)
    own.globalCompositeOperation = "source-atop"
    own.fillStyle = `rgba(0, 0, 0, ${shade})`
    own.fillRect(0, 0, 16, 16)
    context.drawImage(layer, 0, 0)
  }
  side([0, 16], [32, -16], [32, 16], 0)
  side([0, 16], [32, 16], [0, 32], 0.2)
  side([32, 32], [32, -16], [0, 32], 0.42)
  return canvas.toDataURL("image/png")
}

/** The sheet of a shape as pixels the shared drawing reads. Null when the browser cannot read it as a picture. */
async function sheetPixels(sheet: string) {
  const loaded = await image(sheet).catch(() => null)
  if (!loaded) return null
  const canvas = document.createElement("canvas")
  canvas.width = loaded.width
  canvas.height = loaded.height
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return null
  context.drawImage(loaded, 0, 0)
  return { width: loaded.width, height: loaded.height, pixels: new Uint8Array(context.getImageData(0, 0, loaded.width, loaded.height).data.buffer) }
}

/**
 * A block that is boxes put together, as the same drawing the outside AI is shown of it (`drawShape`, the game's own
 * cutout drawing: one-sided faces, the face shades, a see-through pixel left out), from the front, the east side and
 * above, the way an inventory shows a block, on a see-through background. It is not drawn a second time here: the
 * geometry, the way a face reads the sheet and the shading all come from the one module, so what the person judges is
 * what the AI looked at. Null when the sheet cannot be read, so the tile says nothing rather than something wrong.
 */
async function shapedBlock(shape: BlockShape) {
  const sheet = await sheetPixels(shape.sheet)
  if (!sheet) return null
  const size = 128
  const drawn = drawShape(shape, sheet, SHAPE_VIEWS.quarter, size, false, true)
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = size
  const context = canvas.getContext("2d")
  if (!context) return null
  context.putImageData(new ImageData(new Uint8ClampedArray(drawn.pixels), size, size), 0, 0)
  return canvas.toDataURL("image/png")
}

// A short fingerprint of a long text (FNV-1a), so a picture's key changes when a sheet or a shape does, not only when its length does.
const fingerprints = new WeakMap<object, string>()
function fingerprint(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193)
  return (hash >>> 0).toString(36)
}
/** What a shape looks like, in one short string: the same shape gives the same string, any change to a box, a face, a turn or the sheet gives another. */
export function shapeStamp(shape: unknown) {
  if (typeof shape !== "object" || shape === null) return ""
  const known = fingerprints.get(shape)
  if (known) return known
  const made = `${fingerprint(JSON.stringify(shape))}`
  fingerprints.set(shape, made)
  return made
}

/**
 * The picture of a block: its real shape when it has one, else a cube of its texture or plain colour. The key holds the
 * shape's stamp, so a changed box or sheet is a new picture even when the saved revision is not counted (a block saved
 * before assets existed has none).
 */
function blockPicture(stamp: string, block: { color: string; texture?: string | null; shape?: unknown }): Picture | null {
  if (blockPaint(block) === "sheet") {
    const shape = BlockShapeSchema.safeParse(block.shape)
    // A shape that does not hold together is not drawn as a cube instead: that would show something the game never will.
    if (!shape.success) return null
    return { key: `block:${stamp}:shape:${shapeStamp(block.shape)}`, pixel: true, load: () => shapedBlock(shape.data) }
  }
  return { key: `block:${stamp}:${block.color}:${block.texture?.length}`, pixel: true, load: () => cube(block.color, block.texture) }
}

/** A boss bar full, pixel for pixel; null when one of its pictures cannot be read. */
function bossBarThumbnail(bar: BossBarDocument) {
  const picture = (() => {
    try {
      const layout = bossBarLayout(bar)
      return drawBossBar(layout, evenLines(layout.segments.length), { phase: 0, health: 1, lit: 0, broke: -1 })
    } catch {
      return null
    }
  })()
  if (!picture) return null
  const canvas = document.createElement("canvas")
  canvas.width = picture.width
  canvas.height = picture.height
  const context = canvas.getContext("2d")
  if (!context) return null
  const image = context.createImageData(picture.width, picture.height)
  image.data.set(picture.pixels)
  context.putImageData(image, 0, 0)
  return canvas.toDataURL("image/png")
}

/** An item with no drawing of its own is one plain colour in the game, so that is what is shown. */
function swatch(color: string) {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 16
  const context = canvas.getContext("2d")
  if (!context) return null
  context.fillStyle = color
  context.fillRect(0, 0, 16, 16)
  return canvas.toDataURL("image/png")
}

/**
 * A recipe as the game's crafting table in small: the nine cells with what goes in them, and what comes
 * out laid over the corner. A material that has no picture here is a plain tile, so the pattern still reads.
 */
async function craft(cells: (string | null | undefined)[], result: string | null) {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 96
  const context = canvas.getContext("2d")
  if (!context) return null
  context.imageSmoothingEnabled = false
  const drawn = await Promise.all([...cells, result].map((url) => (url ? image(url).catch(() => null) : null)))
  cells.forEach((value, index) => {
    const x = (index % 3) * 26
    const y = Math.floor(index / 3) * 26
    context.fillStyle = "#373737"
    context.fillRect(x, y, 26, 26)
    context.fillStyle = "#ffffff"
    context.fillRect(x + 2, y + 2, 24, 24)
    context.fillStyle = "#8b8b8b"
    context.fillRect(x + 2, y + 2, 22, 22)
    if (value === null) return
    const picture = drawn[index]
    if (picture) return context.drawImage(picture, x + 3, y + 3, 20, 20)
    context.fillStyle = "#d8d8d8"
    context.fillRect(x + 7, y + 7, 12, 12)
    context.fillStyle = "#5a5a5a"
    context.fillRect(x + 9, y + 9, 8, 8)
  })
  context.fillStyle = "#1e1e1e"
  context.fillRect(44, 44, 52, 52)
  context.fillStyle = "#c6c6c6"
  context.fillRect(46, 46, 48, 48)
  const made = drawn.at(-1)
  if (made) context.drawImage(made, 49, 49, 42, 42)
  if (made) return canvas.toDataURL("image/png")
  // What comes out has no picture here (something from the game): the same plain tile as a material without one.
  context.fillStyle = "#e6e6e6"
  context.fillRect(58, 58, 24, 24)
  context.fillStyle = "#5a5a5a"
  context.fillRect(62, 62, 16, 16)
  return canvas.toDataURL("image/png")
}

const assetOf = (project: Project, id: string | null | undefined) => (id ? project.workspace.assets.find((asset) => asset.id === id) : undefined)

/** The workspace texture with this id, when it is one. */
export function textureOf(project: Project, id: string | null | undefined) {
  const asset = assetOf(project, id)
  return asset?.document.kind === "texture" ? { asset, document: asset.document } : null
}

/** The record of something saved before assets existed: the id after the colon of a `kind:id` item. */
export function contentId(item: Pick<OverviewItem, "id" | "preview">) {
  return item.preview.source === "content" ? item.id.slice(item.id.indexOf(":") + 1) : undefined
}

/** The item's own saved document, when it has one. */
export function documentOf(project: Project, item: Pick<OverviewItem, "asset_id" | "preview">) {
  return item.preview.source === "asset" ? assetOf(project, item.asset_id)?.document : undefined
}

/** Animations saved on their own for this model; they play on it like the ones it came with. */
export function extraAnimations(project: Project, modelId: string) {
  return project.workspace.assets.flatMap((asset) =>
    asset.document.kind === "animation" && asset.dependencies.includes(modelId) ? [asset.document] : [],
  )
}

/** Changes exactly when the model, or the texture it wears, was saved again. */
export const lookStamp = (projectId: string, project: Project, source: Source) =>
  [
    projectId,
    source.entity_id,
    source.model_asset_id,
    assetOf(project, source.model_asset_id)?.revision,
    // A creature without a workspace model gets a new model file id whenever its model is saved again.
    project.entities.find((value) => value.id === source.entity_id)?.model_asset_id,
    source.texture_asset_id,
    assetOf(project, source.texture_asset_id)?.revision,
  ].join(":")

/**
 * A model ready for the viewport. The compiled shape, and where each face sits on the texture, come from
 * the app; the texture it wears is the workspace one the overview names, laid over that. Kept per revision,
 * because asking the app is not free. Null when there is no model to draw.
 */
export function modelLook(projectId: string, project: Project, source: Source) {
  const key = lookStamp(projectId, project, source)
  const known = looks.get(key)
  if (known) return known
  const asset = assetOf(project, source.model_asset_id)
  const texture = textureOf(project, source.texture_asset_id)
  const work = (source.entity_id ? window.studio.getEntityPreview({ projectId, entityId: source.entity_id }) : Promise.resolve(null))
    .catch(() => {
      // Not remembered, so the next look asks the app again.
      looks.delete(key)
      return null
    })
    .then((result): Look | null => {
      const sheet = texture ? textureUrl(texture.document) : null
      if (result?.model && result.preview)
        return { model: result.model, preview: { ...result.preview, textureDataUrl: sheet ?? result.preview.textureDataUrl }, texture: sheet }
      if (asset?.document.kind !== "model") return result?.model ? { model: result.model, preview: null, texture: null } : null
      // Without the compiled shape there is nowhere to put a texture: the model shows in its own colours.
      const { kind: _kind, ...design } = asset.document
      return { model: design, preview: null, texture: null }
    })
  looks.set(key, work)
  if (looks.size > 120) looks.delete(looks.keys().next().value!)
  return work
}

/** Drop what is remembered of a model that never arrived, so it can be asked for again. */
export function forgetLook(projectId: string, project: Project, source: Source) {
  looks.delete(lookStamp(projectId, project, source))
}

function modelPicture(projectId: string, project: Project, source: Source): Picture | null {
  if (!source.entity_id && assetOf(project, source.model_asset_id)?.document.kind !== "model") return null
  return {
    key: `model:${lookStamp(projectId, project, source)}`,
    pixel: false,
    load: async () => {
      const look = await modelLook(projectId, project, source)
      if (!look) throw new Error("no model to draw")
      return snapshotModel(look.model, look.preview, 192)
    },
  }
}

/** What "namespace:name" stands for: one of this mod's own blocks or items, or something from the game. */
export function named(projectId: string, project: Project, items: OverviewItem[], reference: string): Named {
  const [namespace, name] = reference.includes(":") ? reference.split(":") : [project.mod_id, reference]
  const game = vanilla[reference]
  // A group of items (「#minecraft:planks」) has no picture of its own; it is named the way the hand editor names it: 「任意木板」.
  if (reference.startsWith("#")) return { name: referenceWords(reference, project.mod_id, () => null), item: null, picture: null }
  if (namespace !== project.mod_id)
    return {
      name: (itemNames as Record<string, string>)[reference] ?? name!.replaceAll("_", " "),
      item: null,
      picture: game
        ? { key: `game:${reference}`, pixel: true, load: () => (game.block ? cube("#808080", game.url) : Promise.resolve(game.url)) }
        : null,
    }
  const own = items.find((item) => {
    if (!["block", "item"].includes(item.kind)) return false
    const document = documentOf(project, item)
    if (document && "identifier" in document) return document.identifier === name
    return [...project.blocks, ...project.items].some((value) => value.id === contentId(item) && value.identifier === name)
  })
  const content = [...project.blocks, ...project.items].find((value) => value.identifier === name)
  return { name: own?.title ?? content?.name ?? name!, item: own?.id ?? null, picture: own ? pictureOf(projectId, project, items, own) : null }
}

/**
 * The picture of one tile, made from what is saved in the project. Null when there is nothing to draw
 * yet (not made) or the kind has no look of its own (rules, notes): the tile then shows the kind's mark.
 */
export function pictureOf(projectId: string, project: Project, items: OverviewItem[], item: Tile, thumbnail = false): Picture | null {
  const asset = assetOf(project, item.asset_id)
  const legacy = contentId(item)
  const document = documentOf(project, item)
  const stamp = `${projectId}:${item.id}:${asset?.revision}`
  if (document?.kind === "sound" && document.files[0]) return {key:(thumbnail ? "wave-square:" : "wave:")+stamp,pixel:false,load:()=>audioWave(document.files[0]!.data, thumbnail)}
  if (document?.kind === "music" && asset) return {key:"wave:"+stamp,pixel:false,load:async()=>audioWave(await window.studio.readMusicPart({projectId,assetId:asset.id,part:"loop"}))}
  if (document?.kind === "fixture") {
    const clip = document.animations.find(value => value.name === document.play.lit)!
    return {key: "fixture:" + stamp, pixel: false, load: async () => snapshotModel(fixtureModel(document), null, 192, clip.length / 2, {animation: clip.name})}
  }
  if (!item.preview.source) return null
  // A creature is its model in its texture; an animation is shown on the model it moves.
  if (["model", "entity", "animation"].includes(item.kind)) return modelPicture(projectId, project, item.preview)
  if (document?.kind === "texture") return { key: `texture:${stamp}`, pixel: true, load: async () => textureUrl(document) }
  if (document?.kind === "gesture") return castPicture(`gesture:${stamp}`, document)
  // An effect (H3) is drawn as the small model it is, at the moment it is fullest in its own motion and in the room everything it reaches fits: the very shot the cover of its look is (`effectShot`),
  // not the pose it is built in, which for a thing that rises out of the ground is a flat column (broad21).
  // Boss 能力 11: a particle is shown by its first picture, pixel for pixel.
  if (document?.kind === "particle") return { key: `particle:${stamp}`, pixel: true, load: async () => particleImage(document.frames[0]!,document.color.start) }
  if (document?.kind === "effect") {
    const shot = effectShot(document)
    return { key: `effect:${stamp}`, pixel: false, load: async () => snapshotModel(effectModel(document), null, 192, shot.time, { animation: shot.animation, camera: shot.camera }) }
  }
  // Boss 能力 6: a bar is shown full, as the game draws it before the first line is crossed (the same drawing as its look's first picture).
  if (document?.kind === "bossbar") return { key: `bossbar:${stamp}`, pixel: true, load: async () => bossBarThumbnail(document) }
  // Code has no look: a sign drawn by us, with the number of behaviours on it (asset-gameplay-sign.ts).
  if (document?.kind === "gameplay") return { key: `gameplay:${document.behaviours.length}`, pixel: true, load: async () => gameplaySign(document.behaviours.length) }
  const block = document?.kind === "block" ? document : item.kind === "block" ? project.blocks.find((value) => value.id === legacy) : undefined
  if (block) return blockPicture(stamp, block)
  const thing = document?.kind === "item" ? document : item.kind === "item" ? project.items.find((value) => value.id === legacy) : undefined
  if (thing) return { key: `item:${stamp}:${thing.color}:${thing.texture?.length}`, pixel: true, load: async () => thing.texture ?? swatch(thing.color) }
  const recipe = document?.kind === "recipe" ? document : item.kind === "recipe" ? project.recipes.find((value) => value.id === legacy) : undefined
  if (!recipe) return null
  const others = items.filter((value) => value.kind !== "recipe")
  const parts = [...recipe.pattern, recipe.result].map((reference) => (reference ? named(projectId, project, others, reference).picture : null))
  return {
    key: `recipe:${stamp}:${recipe.pattern.join()}:${recipe.result}:${parts.map((part) => part?.key).join()}`,
    pixel: true,
    load: async () => {
      // Not queued: this picture already holds a place in the queue while it waits for its parts.
      const urls = await Promise.all(parts.map((part) => (part ? loadPicture(part, false) : null)))
      return craft(recipe.pattern.map((reference, index) => (reference === null ? null : (urls[index] ?? undefined))), urls.at(-1) ?? null)
    },
  }
}

export type CastSide = "first_person" | "third_person"
type CastFrames = ReturnType<typeof gesturePlayerPreview>["resolved"]["timeline"]["frames"]

// How far the arms turn between two ticks: the busier arm counts.
const travel = (frames: CastFrames, from: number, to: number) =>
  Math.max(...(["right_arm", "left_arm"] as const).map((arm) => Math.hypot(...frames[to]![arm].rotation.map((value, axis) => value - frames[from]![arm].rotation[axis]!))))

/**
 * What the viewport needs to play one side of a cast action once through: the block figure other players
 * see, or the player's own arms from their own eyes (`camera` is then the game's, to be used as given).
 * Each phase carries `still`, the moment that shows it best; the release's is where the strike lands.
 * Display only, never a model to edit or save. Throws when the document is not a playable cast action.
 */
export function castLook(document: unknown, side: CastSide) {
  const eyes = side === "first_person" ? gestureFirstPersonPreview(document, { loop: false }) : null
  const made = eyes ?? gesturePlayerPreview(document, { loop: false })
  const timeline = made.resolved.timeline
  const first = timeline.ticks.windup + timeline.ticks.hold
  // The strike lands at the end of the three ticks in which the arms travel furthest.
  const landed = Array.from({ length: timeline.ticks.release }, (_, index) => first + index + 1).reduce((best, tick) =>
    travel(timeline.frames, Math.max(first, tick - 3), tick) > travel(timeline.frames, Math.max(first, best - 3), best) ? tick : best,
  )
  return {
    design: made.design,
    preview: { geometry: made.geometry, textureDataUrl: made.textureDataUrl, animation: made.animation } as Preview,
    camera: eyes?.camera,
    /** Nothing to draw: this cast action hides the player's own arms in first person. */
    hidden: made.design.bones.every((bone) => bone.cubes.every((cube) => cube.size.every((value) => value === 0))),
    length: made.length,
    phases: made.phases.map((phase) => ({
      ...phase,
      still: phase.id === "release" ? landed * GESTURE_TICK : phase.id === "windup" ? phase.end : Math.round((phase.start + phase.end) / 2 / GESTURE_TICK) * GESTURE_TICK,
    })),
  }
}

/** What other players see at the moment the strike lands, as a still picture. */
function castPicture(key: string, document: unknown): Picture {
  return {
    key,
    pixel: false,
    load: async () => {
      const look = castLook(document, "third_person")
      return snapshotModel(look.design, look.preview, 192, look.phases.find((phase) => phase.id === "release")!.still)
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
const text = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback)

/**
 * The picture of a draft an outside AI has shown so far. Only shapes that are complete enough to draw
 * give one; anything else is null and the tile keeps saying it is being made.
 */
export function draftPicture(draft: Draft): Picture | null {
  const document = draft.document
  if (!isRecord(document)) return null
  const key = `draft:${draft.kind}:${draft.title}:${JSON.stringify(document).length}:${draft.progress}`
  if (draft.kind === "model" && Array.isArray(document.bones) && Array.isArray(document.animations))
    return { key, pixel: false, load: async () => snapshotModel(document as unknown as ModelDesign, null, 192) }
  if (draft.kind === "texture" && Array.isArray(document.pixels) && Array.isArray(document.palette) && typeof document.width === "number")
    return { key, pixel: true, load: async () => textureUrl(document as unknown as Texture) }
  // A half-written cast action cannot be played, so it gives no picture and the tile keeps saying it is being made.
  if (draft.kind === "gesture" && GestureDocumentSchema.safeParse(document).success) return castPicture(key, document)
  if (draft.kind === "block" && typeof document.color === "string") {
    // A half-written shape gives no picture (the tile keeps saying it is being made); it is never drawn as a coloured cube instead.
    return blockPicture(`${key}:${shapeStamp(document.shape)}`, { color: text(document.color, "#808080"), texture: typeof document.texture === "string" ? document.texture : null, shape: document.shape ?? null })
  }
  if (draft.kind === "item" && typeof document.color === "string")
    return { key, pixel: true, load: async () => (typeof document.texture === "string" ? document.texture : swatch(text(document.color, "#808080"))) }
  return null
}

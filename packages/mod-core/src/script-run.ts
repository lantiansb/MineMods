import { z } from "zod"
import { BlockShapeSchema, SHAPE_FACES, type BlockShape } from "@minemods/studio-ai/block-shape"
import { DRAWN_PICTURES, isScripted, SCRIPT_ERRORS, SCRIPT_LIMITS, type ScriptedKind, type ScriptWears, type TracePicture } from "@minemods/studio-ai/script"
import { encodePng } from "./png"
import { fitModelAtlas } from "./model"
import { modelBounds } from "./model-bounds"
import { runSandboxed } from "./script-sandbox"
import { GEOMETRY_TIERS, scriptTier } from "@minemods/studio-ai/budget"
import { getModuleSchema, MODULES, type ModuleDocument } from "./workspace"

export * from "@minemods/studio-ai/script"

/**
 * From a script to a document. The script is run shut away (`script-sandbox.ts`); what it hands back is
 * read as data and held to the same schema as a document typed by hand. From here on nothing knows or
 * cares that a script wrote it: looking, the standard, review, saving and building take the document.
 */

/** `pictures`: the task's concept pictures for `api.trace`, made ready by `conceptPictures`; left out when the task has none. */
export type RunLimits = { seconds?: number; memoryMb?: number; pictures?: TracePicture[] }

type Model = Extract<ModuleDocument, { kind: "model" }>
type Scripted = Extract<ModuleDocument, { kind: ScriptedKind }>

/** A document in a few words, for whoever wrote the script to check it came out as meant. */
export type ScriptSummary =
  | { kind: "model"; bones: number; cubes: number; texture_size: number; animations: { name: string; length: number; bones: number }[]; size: [number, number, number] }
  | { kind: "texture"; width: number; height: number; colours: number }
  | { kind: "animation"; name: string; length: number; loop: boolean; bones: number; keyframes: number }
  /** A block's or an item's own picture: its size, how many colours it has and how many of its pixels were left empty. */
  | { kind: "picture"; width: number; height: number; colours: number; empty: number; /** How many pictures the script handed back, when more than this first one. */ pictures?: number }
  /** A block that is boxes put together: how many boxes and drawn faces, the sheet's side, and how it faces and what stops a player. */
  | { kind: "shape"; elements: number; faces: number; sheet: number; facing: BlockShape["facing"]; collision: BlockShape["collision"] }

export type ScriptRun = { ok: true; document: Scripted; summary: ScriptSummary; notes: string[] } | { ok: false; error: string; line: number | null }

/** Thrown where a script was handed in and did not yield a document. The message is the whole of what its author is told. */
export class ScriptFailure extends Error {
  constructor(
    message: string,
    readonly line: number | null = null,
  ) {
    super(message)
  }
}

/** What a script is told of the model its texture dresses or its animation moves: the bones, and where each face lies on the texture. */
export function scriptWears(model: Model): ScriptWears | null {
  const { kind: _kind, ...design } = model
  // A model whose faces fit no texture has no places to tell of; the script is then given none.
  const compiled = (() => {
    try {
      return fitModelAtlas(design, "script")
    } catch {
      return null
    }
  })()
  if (!compiled) return null
  return {
    texture_size: compiled.geometry["minecraft:geometry"][0]!.description.texture_width,
    bones: compiled.design.bones.map((bone) => ({ name: bone.name, parent: bone.parent, pivot: bone.pivot, rotation: bone.rotation, cubes: bone.cubes.map((cube) => ({ name: cube.name, origin: cube.origin, size: cube.size })) })),
    faces: compiled.geometry["minecraft:geometry"][0]!.bones.flatMap((bone, boneIndex) =>
      bone.cubes.flatMap((cube, cubeIndex) =>
        Object.entries(cube.uv).map(([face, placed]) => ({ bone: bone.name, cube: compiled.design.bones[boneIndex]!.cubes[cubeIndex]!.name, face, x: placed.uv[0]!, y: placed.uv[1]!, width: placed.uv_size[0]!, height: placed.uv_size[1]! })),
      ),
    ),
  }
}

export function summarise(document: Scripted): ScriptSummary {
  if (document.kind === "texture") return { kind: "texture", width: document.width, height: document.height, colours: document.palette.length }
  if (document.kind === "animation") return { kind: "animation", name: document.name, length: document.length, loop: document.loop, bones: document.channels.length, keyframes: document.channels.reduce((sum, channel) => sum + channel.keyframes.length + (channel.position?.length ?? 0) + (channel.scale?.length ?? 0), 0) }
  const { kind: _kind, ...design } = document
  const bounds = modelBounds(design)
  return {
    kind: "model",
    bones: document.bones.length,
    cubes: document.bones.reduce((sum, bone) => sum + bone.cubes.length, 0),
    texture_size: document.texture_size,
    animations: document.animations.map((motion) => ({ name: motion.name, length: motion.length, bones: motion.channels.length })),
    // How much room it takes at rest, in pixels: across, tall, front to back.
    size: [0, 1, 2].map((axis) => Math.round((bounds.max[axis]! - bounds.min[axis]!) * 10) / 10) as [number, number, number],
  }
}

/**
 * Run a script that is to produce a document of `kind`. Always answers: the document with a summary, or
 * one plain sentence on why there is none. `wears` is the model a texture dresses or an animation moves.
 */
export async function runScript(kind: string, source: string, wears: Model | null = null, limits: RunLimits = {}): Promise<ScriptRun> {
  if (!isScripted(kind)) return { ok: false, error: SCRIPT_ERRORS.not_scripted(MODULES[kind as keyof typeof MODULES]?.label ?? kind), line: null }
  // 第 1 步: a model script's clock is its tier's (`script_seconds`, read from the budget its api.model names); everything else is limited as before.
  const ran = await runSandboxed(source, { wears: wears ? scriptWears(wears) : null, ...limits, seconds: limits.seconds ?? (kind === "model" ? GEOMETRY_TIERS[scriptTier(source)].script_seconds : undefined) })
  if (!ran.ok) return ran
  const got = (ran.value as { kind?: unknown }).kind
  if (got !== kind) return { ok: false, error: SCRIPT_ERRORS.wrong_kind(kind, typeof got === "string" ? got.slice(0, 40) : "没有 kind 的东西"), line: null }
  const parsed = getModuleSchema(kind).safeParse(ran.value)
  if (!parsed.success)
    return {
      ok: false,
      error: SCRIPT_ERRORS.invalid(
        MODULES[kind].label,
        parsed.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".") || "文档"}：${issue.message}`),
      ),
      line: null,
    }
  const document = parsed.data as Scripted
  return { ok: true, document, summary: summarise(document), notes: ran.notes.slice(0, SCRIPT_LIMITS.notes) }
}

/** The same, for a caller that wants the document or nothing: a script that yields none throws what its author is to be told. */
export async function scripted(kind: string, source: string, wears: Model | null = null) {
  const ran = await runScript(kind, source, wears)
  if (!ran.ok) throw new ScriptFailure(ran.error, ran.line)
  return ran
}

const ParticlePictureSchema = z
  .strictObject({
    kind: z.literal("picture"),
    width: z.number().int().min(1).max(SCRIPT_LIMITS.texture),
    height: z.number().int().min(1).max(SCRIPT_LIMITS.texture),
    palette: z.array(z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/)),
    pixels: z.array(z.number().int().min(-1)),
  })
  .refine((picture) => picture.pixels.length === picture.width * picture.height && picture.pixels.every((index) => index < picture.palette.length))

const PictureSchema = ParticlePictureSchema.refine(picture => picture.palette.every(color => color.length === 7))

/** `variants`: the pictures after the first, when the script handed back a list (a block the game shows differently from place to place); empty otherwise. */
export type DrawingRun = { ok: true; texture: string; variants: string[]; summary: Extract<ScriptSummary, { kind: "picture" }>; notes: string[] } | { ok: false; error: string; line: number | null }

/** A picture the script drew, as a PNG data URL: a pixel with no colour (-1) is transparent. */
const pngOf = (picture: z.infer<typeof PictureSchema>) =>
  `data:image/png;base64,${Buffer.from(encodePng(Uint8Array.from(picture.pixels.flatMap((index) => (index < 0 ? [0, 0, 0, 0] : [...[1, 3, 5].map((start) => Number.parseInt(picture.palette[index]!.slice(start, start + 2), 16)), Number.parseInt(picture.palette[index]!.slice(7,9) || "ff",16)]))), picture.width, picture.height)).toString("base64")}`

type Ran = { value: unknown; notes: string[] }

function drawingOf(ran: Ran, particle = false): DrawingRun {
  const got = (ran.value as { kind?: unknown; pictures?: unknown }).kind
  const listed = got === "pictures" ? (ran.value as { pictures?: unknown }).pictures : [ran.value]
  if (particle && (!Array.isArray(listed) || got !== "pictures" || listed.length > 8)) return {ok:false,error:"粒子脚本要 return 1 到 8 张画布的列表。",line:null}
  if (!particle && Array.isArray(listed) && listed.length > DRAWN_PICTURES) return { ok: false, error: SCRIPT_ERRORS.too_many_pictures(listed.length), line: null }
  const parsed = z.array(particle ? ParticlePictureSchema : PictureSchema).min(1).safeParse(listed)
  if (!parsed.success) return { ok: false, error: SCRIPT_ERRORS.not_a_picture(typeof got === "string" ? `${got.slice(0, 40)} 文档` : "别的东西"), line: null }
  const picture = parsed.data[0]!
  if (particle && parsed.data.some(p=>p.width!==p.height || p.width>32 || p.width!==picture.width)) return {ok:false,error:"粒子帧要一样大、正方形，边长最多 32 像素。",line:null}
  return {
    ok: true,
    texture: pngOf(picture),
    variants: parsed.data.slice(1).map(pngOf),
    summary: { kind: "picture", width: picture.width, height: picture.height, colours: picture.palette.length, empty: picture.pixels.filter((index) => index < 0).length, ...(parsed.data.length > 1 ? { pictures: parsed.data.length } : {}) },
    notes: ran.notes.slice(0, SCRIPT_LIMITS.notes),
  }
}

/**
 * Run a script that draws the picture a block or an item has, or the several pictures of a block. Always
 * answers: the pictures as PNG data URLs, ready for the document's `texture` and `variants`, or one plain
 * sentence on why there are none.
 */
export async function runDrawing(source: string, limits: RunLimits & { particle?: boolean } = {}): Promise<DrawingRun> {
  const ran = await runSandboxed(source, { flat: true, ...limits })
  return ran.ok ? drawingOf(ran, limits.particle) : ran
}

/** What a script made of a block that is boxes put together: the shape, held to the same schema as one typed by hand. */
export type ShapeRun = { ok: true; shape: BlockShape; summary: Extract<ScriptSummary, { kind: "shape" }>; notes: string[] } | { ok: false; error: string; line: number | null }

function shapeOf(ran: Ran): ShapeRun {
  const body = ran.value as { facing?: unknown; collision?: unknown; elements?: unknown; sheet?: unknown }
  const sheet = PictureSchema.safeParse(body.sheet)
  if (!sheet.success) return { ok: false, error: SCRIPT_ERRORS.not_a_picture("没有画布的外形"), line: null }
  const parsed = BlockShapeSchema.safeParse({ facing: body.facing, collision: body.collision, elements: body.elements, sheet: pngOf(sheet.data) })
  if (!parsed.success)
    return {
      ok: false,
      error: SCRIPT_ERRORS.invalid(
        "方块的外形",
        parsed.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".") || "外形"}：${issue.message}`),
      ),
      line: null,
    }
  const shape = parsed.data
  return {
    ok: true,
    shape,
    summary: { kind: "shape", elements: shape.elements.length, faces: shape.elements.reduce((count, element) => count + SHAPE_FACES.filter((face) => element.faces[face]).length, 0), sheet: sheet.data.width, facing: shape.facing, collision: shape.collision },
    notes: ran.notes.slice(0, SCRIPT_LIMITS.notes),
  }
}

/**
 * The same for a block, whose script may also hand back a shape (`return { elements, sheet, facing, collision }`)
 * in place of a picture. Always answers: the picture(s) or the shape, or one plain sentence on why there is neither.
 */
export async function runBlockDrawing(source: string, limits: RunLimits = {}): Promise<DrawingRun | ShapeRun> {
  const ran = await runSandboxed(source, { flat: true, ...limits })
  if (!ran.ok) return ran
  return (ran.value as { kind?: unknown }).kind === "shape" ? shapeOf(ran) : drawingOf(ran)
}

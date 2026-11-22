import { inflateSync } from "node:zlib"
import { z } from "zod"
import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import { bakeFitted, channelTracks, type AnimationTrack as TrackName } from "@minemods/studio-ai/animation"
import { contractKey, contractKeyWords } from "./blockbench-keys"
import { compileModel } from "./model"
import { boneNamesFor } from "./bone-names"

const Vector3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
const UvSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
const FaceSchema = z.object({
  uv: UvSchema.optional(),
  texture: z.union([z.number().int(), z.null(), z.literal(false)]).optional(),
  rotation: z.number().finite().optional(),
}).passthrough()
const ElementSchema = z.object({
  uuid: z.string().min(1),
  name: z.string().optional(),
  type: z.string().optional(),
  from: Vector3Schema,
  to: Vector3Schema,
  origin: Vector3Schema.optional(),
  rotation: Vector3Schema.optional(),
  rotation_axis: z.enum(["x", "y", "z"]).optional(),
  rotation_type: z.string().optional(),
  faces: z.record(z.string(), FaceSchema),
}).passthrough()
type Element = z.infer<typeof ElementSchema>

type OutlinerNode = {
  uuid: string
  name: string
  origin: [number, number, number]
  rotation: [number, number, number]
  children: Array<string | OutlinerNode>
}
const OutlinerNodeSchema: z.ZodType<OutlinerNode> = z.lazy(() => z.object({
  uuid: z.string().min(1),
  name: z.string().min(1),
  origin: Vector3Schema,
  rotation: Vector3Schema,
  children: z.array(z.union([z.string(), OutlinerNodeSchema])),
}).passthrough())

const KeyframeSchema = z.object({
  time: z.number().finite().min(0).max(30),
  channel: z.string().optional(),
  interpolation: z.string().optional(),
  data_points: z.array(z.object({
    x: z.union([z.number().finite(), z.string()]),
    y: z.union([z.number().finite(), z.string()]),
    z: z.union([z.number().finite(), z.string()]),
  }).passthrough()).optional(),
}).passthrough()
const AnimatorSchema = z.object({ keyframes: z.array(KeyframeSchema).default([]) }).passthrough()
const AnimationSchema = z.object({
  name: z.string().min(1),
  length: z.number().finite().positive().max(30),
  loop: z.union([z.boolean(), z.string()]),
  animators: z.record(z.string(), AnimatorSchema).optional(),
}).passthrough()
const TextureSchema = z.object({
  path: z.string().optional(),
  source: z.string().optional(),
}).passthrough()
const ProjectSchema = z.object({
  resolution: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).passthrough().optional(),
  elements: z.array(ElementSchema).optional(),
  outliner: z.array(z.union([z.string(), OutlinerNodeSchema])).optional(),
  groups: z.array(z.object({ uuid: z.string().min(1), name: z.string().min(1), origin: Vector3Schema, rotation: Vector3Schema }).passthrough()).optional(),
  animations: z.array(AnimationSchema).optional(),
  textures: z.array(TextureSchema).optional(),
}).passthrough()

type EditableProject = z.infer<typeof ProjectSchema>
type GroupRecord = { uuid: string; node: OutlinerNode; parent: string | null; elementIds: string[] }
type DesignBoneMatch = { group: GroupRecord; bone: ModelDesign["bones"][number] }

/** `detail` rides after a colon (`CODE:detail`) so a message can name the group at fault; callers that match the bare code still find it at the start. */
function fail(code: string, detail?: string): never {
  throw new Error(detail === undefined ? code : `${code}:${detail}`)
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  bytes.forEach((value) => {
    crc ^= value
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  })
  return (crc ^ 0xffffffff) >>> 0
}

function validateEmbeddedPng(bytes: Uint8Array, width: number, height: number) {
  const signature = "89504e470d0a1a0a"
  if (bytes.length < 33 || Buffer.from(bytes.subarray(0, 8)).toString("hex") !== signature) fail("MODEL_PNG_INVALID")
  let cursor = 8
  let seenHeader = false
  let seenEnd = false
  const idat: Uint8Array[] = []
  while (cursor + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + cursor, 4).getUint32(0)
    const end = cursor + 12 + length
    if (end > bytes.length) fail("MODEL_PNG_INVALID")
    const type = Buffer.from(bytes.subarray(cursor + 4, cursor + 8)).toString("ascii")
    const data = bytes.subarray(cursor + 8, cursor + 8 + length)
    const expectedCrc = new DataView(bytes.buffer, bytes.byteOffset + cursor + 8 + length, 4).getUint32(0)
    if (crc32(bytes.subarray(cursor + 4, cursor + 8 + length)) !== expectedCrc) fail("MODEL_PNG_INVALID")
    if (type === "IHDR") {
      if (seenHeader || length !== 13) fail("MODEL_PNG_INVALID")
      const header = new DataView(data.buffer, data.byteOffset, data.byteLength)
      if (header.getUint32(0) !== width || header.getUint32(4) !== height || data[8] !== 8 || data[9] !== 6 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0)
        fail("MODEL_PNG_DIMENSIONS")
      seenHeader = true
    }
    if (type === "IDAT") idat.push(data)
    if (type === "IEND") {
      if (length !== 0 || seenEnd) fail("MODEL_PNG_INVALID")
      seenEnd = true
    }
    cursor = end
  }
  if (!seenHeader || !seenEnd || cursor !== bytes.length || idat.length === 0) fail("MODEL_PNG_INVALID")
  const scanlines = inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk))))
  if (scanlines.length !== height * (width * 4 + 1) || scanlines.some((value, index) => index % (width * 4 + 1) === 0 && value > 4)) fail("MODEL_PNG_INVALID")
  return Buffer.from(bytes)
}

function parseTexture(project: EditableProject, width: number, height: number) {
  const textures = project.textures ?? []
  if (textures.length === 0) fail("MODEL_TEXTURE_REQUIRED")
  if (textures.length !== 1) fail("MODEL_TEXTURE_COUNT")
  const texture = textures[0]!
  if (texture.path) fail("MODEL_EXTERNAL_TEXTURE")
  if (!texture.source?.startsWith("data:image/png;base64,")) fail("MODEL_EMBEDDED_TEXTURE_REQUIRED")
  if (project.resolution && (project.resolution.width !== width || project.resolution.height !== height)) fail("MODEL_PNG_DIMENSIONS")
  const encoded = texture.source.slice("data:image/png;base64,".length)
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail("MODEL_PNG_INVALID")
  return validateEmbeddedPng(Buffer.from(encoded, "base64"), width, height)
}

function flattenGroups(nodes: Array<string | OutlinerNode>, parent: string | null, groups: GroupRecord[]) {
  nodes.forEach((node) => {
    if (typeof node === "string") return
    const record = { uuid: node.uuid, node, parent, elementIds: node.children.filter((child): child is string => typeof child === "string") }
    groups.push(record)
    flattenGroups(node.children, node.uuid, groups)
  })
}

function readGroups(project: EditableProject, elements: Element[]) {
  const groups: GroupRecord[] = []
  if (project.outliner) flattenGroups(project.outliner, null, groups)
  if (!groups.length) fail("MODEL_HIERARCHY_REQUIRED")
  if (groups.filter((group) => group.parent === null).length !== 1) fail("MODEL_HIERARCHY_ROOT")
  const elementIds = new Set(elements.map((element) => element.uuid))
  const assigned = new Set<string>()
  groups.forEach((group) => group.elementIds.forEach((id) => {
    if (!elementIds.has(id) || assigned.has(id)) fail("MODEL_HIERARCHY_INVALID")
    assigned.add(id)
  }))
  if (assigned.size !== elements.length) fail("MODEL_HIERARCHY_INVALID")
  return groups
}

// A group is found again by the name the importer (`blockbench.ts`) gave its bone, because a ModelDesign knows bones by name and
// Blockbench by uuid. Both sides make that name with `boneNamesFor`, so repeated group names and boxes named like bones cannot
// make them disagree; the uuid stays the key for everything Blockbench-side (children, animators, elements).
function groupDesignNames(groups: GroupRecord[]) {
  const names = boneNamesFor(groups.map((group) => group.node.name))
  return new Map(groups.map((group, index) => [group.uuid, names[index]!] as const))
}

function matchGroupsToDesign(design: ModelDesign, groups: GroupRecord[]) {
  const designBones = new Map(design.bones.map((bone) => [bone.name, bone]))
  const groupsByUuid = new Map(groups.map((group) => [group.uuid, group]))
  const groupNames = groupDesignNames(groups)
  const matchedNames = new Set<string>()
  const matches = new Map<string, DesignBoneMatch>()
  groups.forEach((group) => {
    const bone = designBones.get(groupNames.get(group.uuid)!)
    if (!bone || matchedNames.has(bone.name)) fail("MODEL_HIERARCHY_DESIGN_MISMATCH", `bone:${group.node.name}`)
    const parent = group.parent === null ? null : groupsByUuid.get(group.parent)
    if (group.parent !== null && !parent) fail("MODEL_HIERARCHY_DESIGN_MISMATCH", `parent:${group.node.name}`)
    if (bone.parent !== (parent ? groupNames.get(parent.uuid) : null)) fail("MODEL_HIERARCHY_DESIGN_MISMATCH", `parent:${group.node.name}`)
    matchedNames.add(bone.name)
    matches.set(group.uuid, { group, bone })
  })
  if (matchedNames.size !== design.bones.length) fail("MODEL_HIERARCHY_DESIGN_MISMATCH", "count:")
  return matches
}

function numberValue(value: number | string) {
  if (typeof value === "number") return value
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) fail("MODEL_EXPRESSION_UNSUPPORTED")
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) fail("MODEL_EXPRESSION_UNSUPPORTED")
  return parsed
}

type AnimationVector = [number, number, number]
type AnimationValue = AnimationVector | { pre: AnimationVector; post: AnimationVector }
type AnimationTrack = {
  name: string
  length: number
  loop: boolean
  bones: Record<string, Record<string, Record<string, AnimationValue>>>
}

const animationName = /^[A-Za-z][A-Za-z0-9_]{0,47}$/
const animationTime = (time: number) => Number.isInteger(time) ? `${time}.0` : String(time)

// Blockbench's keyframe interpolations the game export can carry are the animation contract's (`blockbench-keys.ts`): linear, step,
// catmullrom (smooth) and, since 第 2 步, bezier with its handles, and the easing GeckoLib's Blockbench plugin writes.
const INTERPOLATION_KNOWN = new Set(["linear", "step", "catmullrom", "bezier"])

function compileAnimationTracks(project: EditableProject, design: ModelDesign, groups: GroupRecord[]) {
  const groupBones = matchGroupsToDesign(design, groups)
  return (project.animations ?? []).map((source): AnimationTrack => {
    if (!animationName.test(source.name)) fail("MODEL_ANIMATION_NAME_UNSAFE")
    const bones: AnimationTrack["bones"] = {}
    Object.entries(source.animators ?? {}).forEach(([uuid, animator]) => {
      const match = groupBones.get(uuid)
      if (!match) fail("MODEL_ANIMATION_BONE_UNKNOWN")
      const channels: Record<string, Record<string, AnimationValue>> = {}
      const keyframesByChannel = new Map<string, typeof animator.keyframes>()
      animator.keyframes.forEach((keyframe) => {
        const kind = keyframe.channel ?? "rotation"
        if (!["rotation", "position", "scale"].includes(kind)) fail("MODEL_ANIMATION_CHANNEL_UNSUPPORTED")
        if (keyframe.interpolation && !INTERPOLATION_KNOWN.has(keyframe.interpolation)) fail("MODEL_INTERPOLATION_UNSUPPORTED")
        const channelKeyframes = keyframesByChannel.get(kind) ?? []
        channelKeyframes.push(keyframe)
        keyframesByChannel.set(kind, channelKeyframes)
      })
      const looping = typeof source.loop === "string" ? source.loop === "loop" : source.loop
      keyframesByChannel.forEach((keyframes, kind) => {
        const sorted = [...keyframes].sort((a, b) => a.time - b.time)
        const words = contractKeyWords(sorted)
        const keys = sorted.map((keyframe, index) => {
          if (!keyframe.data_points || keyframe.data_points.length !== 1) fail("MODEL_ANIMATION_CHANNEL_UNSUPPORTED")
          const point = keyframe.data_points[0]!
          return contractKey(keyframe.time, [numberValue(point.x), numberValue(point.y), numberValue(point.z)] as AnimationVector, { interpolation: "linear", ...words[index] })
        })
        if (new Set(keys.map((key) => animationTime(key.time))).size !== keys.length) fail("MODEL_ANIMATION_KEYFRAME_DUPLICATE")
        // Blockbench's own interpolation is the animation contract's: held values end with pre/post, curves are cut into straight pieces.
        // Round 10: the same fitted bake as a design's own (`bakeFitted`), so what was looked at and what is saved are one export.
        const fitted = bakeFitted(keys, looping, kind as TrackName)
        if (fitted.over) fail("MODEL_ANIMATION_EXPORT_TOO_LONG")
        channels[kind] = Object.fromEntries(fitted.keys.map((key) => [animationTime(key.time), key.pre ? { pre: key.pre, post: key.value } : key.value]))
      })
      bones[match.bone.name] = channels
    })
    return { name: source.name, length: source.length, loop: typeof source.loop === "string" ? source.loop === "loop" : source.loop, bones }
  })
}

/** A design channel's rotation track as the editor's file holds it when nothing was changed there. */
const exported = (channel: ModelDesign["animations"][number]["channels"][number], loop: boolean) =>
  Object.fromEntries(bakeFitted(channelTracks(channel).rotation, loop, "rotation").keys.map((key) => [animationTime(key.time), key.pre ? { pre: key.pre, post: key.value } : key.value]))

function compileNumericAnimations(tracks: AnimationTrack[], design: ModelDesign) {
  return design.animations.map((base) => {
    const source = tracks.find((animation) => animation.name === base.name)
    if (!source) return base
    const channels = base.channels.map((channel) => {
      const rotation = source.bones[channel.bone]?.rotation
      if (!rotation) return channel
      // Round 10: a track the editor's file still holds exactly as the design exports it stays as it was written, curves and
      // all. Only a track changed in the editor is read back as numbers; putting an unchanged curve's straight pieces in
      // place of the keys that were written held them to the limit on written keys and refused a version that had been looked at.
      if (JSON.stringify(rotation) === JSON.stringify(exported(channel, base.loop))) return channel
      const keyframes = Object.entries(rotation).map(([time, value]) => ({
        time: Number(time),
        rotation: (Array.isArray(value) ? value : value.post) as AnimationVector,
      }))
      return { ...channel, keyframes }
    })
    return { ...base, length: source.length, loop: source.loop, channels }
  })
}

function mergeAnimationTracks(compiled: ReturnType<typeof compileModel>, tracks: AnimationTrack[], identifier: string) {
  type AnimationOutput = { loop: boolean; animation_length: number; bones: Record<string, Record<string, Record<string, AnimationValue>>> }
  const animations = compiled.animation.animations as unknown as Record<string, AnimationOutput>
  tracks.forEach((track) => {
    const key = `animation.${identifier}.${track.name}`
    const output = animations[key] ?? { loop: track.loop, animation_length: track.length, bones: {} }
    output.loop = track.loop
    output.animation_length = track.length
    Object.entries(track.bones).forEach(([bone, channels]) => {
      output.bones[bone] = { ...(output.bones[bone] ?? {}), ...channels }
    })
    animations[key] = output
  })
  return compiled
}

function applyEditableGeometry(compiled: ReturnType<typeof compileModel>, design: ModelDesign, groups: GroupRecord[], elements: Element[]) {
  if (compiled.geometry["minecraft:geometry"][0]!.bones.length !== groups.length || design.bones.length !== groups.length) fail("MODEL_HIERARCHY_DESIGN_MISMATCH", "count:")
  const elementById = new Map(elements.map((element) => [element.uuid, element]))
  type GeometryCube = {
    origin: number[]
    size: number[]
    uv: Record<string, { uv: number[]; uv_size: number[] }>
    name?: string
    uuid?: string
    rotation?: number[]
    pivot?: number[]
  }
  type GeometryBone = { name: string; parent?: string; cubes: GeometryCube[]; uuid?: string }
  const geometryBones = compiled.geometry["minecraft:geometry"][0]!.bones as unknown as GeometryBone[]
  const groupBones = matchGroupsToDesign(design, groups)
  const geometryByName = new Map(geometryBones.map((bone) => [bone.name, bone]))
  groups.forEach((group) => {
    const match = groupBones.get(group.uuid)
    const bone = match ? geometryByName.get(match.bone.name) : undefined
    if (!match || !bone) fail("MODEL_HIERARCHY_DESIGN_MISMATCH", `bone:${group.node.name}`)
    if (bone.cubes.length !== group.elementIds.length) fail("MODEL_HIERARCHY_DESIGN_MISMATCH", `cubes:${group.node.name}`)
    if ((bone.parent ?? null) !== match.bone.parent) fail("MODEL_HIERARCHY_DESIGN_MISMATCH", `parent:${group.node.name}`)
    group.elementIds.forEach((elementId, cubeIndex) => {
      const element = elementById.get(elementId)!
      if (element.type && element.type !== "cube") fail("MODEL_MESH_UNSUPPORTED")
      if (element.rotation_type) fail("MODEL_ROTATION_TYPE_UNSUPPORTED")
      if (element.rotation_axis && !["x", "y", "z"].includes(element.rotation_axis)) fail("MODEL_ROTATION_TYPE_UNSUPPORTED")
      const cube = bone.cubes[cubeIndex]!
      const faces = Object.fromEntries(([
        "north", "east", "south", "west", "up", "down",
      ] as const).map((face) => {
        const source = element.faces[face]
        if (!source?.uv) fail("MODEL_UV_MISSING")
        if (source.texture === false || source.texture === null) fail("MODEL_FACE_TEXTURE_UNSUPPORTED:不支持透明或无纹理面")
        if (source.texture !== undefined && source.texture !== 0) fail("MODEL_MULTI_TEXTURE:不支持多贴图")
        if (source.rotation !== undefined && source.rotation !== 0) fail("MODEL_FACE_ROTATION_UNSUPPORTED:不支持面内UV旋转")
        return [face, { uv: [source.uv[0], source.uv[1]], uv_size: [source.uv[2] - source.uv[0], source.uv[3] - source.uv[1]] }]
      })) as Record<string, { uv: number[]; uv_size: number[] }>
      bone.cubes[cubeIndex] = {
        ...cube,
        name: element.name ?? cube.name,
        uuid: element.uuid,
        uv: faces,
        ...(element.rotation ? { rotation: element.rotation } : {}),
        ...(element.origin ? { pivot: element.origin } : {}),
      }
    })
    ;(bone as typeof bone & { uuid?: string }).uuid = group.uuid
  })
  return compiled
}

/** Compile a saved asset while retaining the editable Blockbench atlas and cube data. */
export function compileSavedModel(data: unknown, identifier: string) {
  if (typeof data !== "object" || data === null || !("design" in data)) return compileModel(data, identifier)
  const parsed = z.object({ design: ModelDesignSchema, blockbench: z.unknown().optional() }).parse(data)
  if (!parsed.blockbench) return compileModel(parsed.design, identifier)
  const project = ProjectSchema.parse(parsed.blockbench)
  const elements = project.elements ?? []
  if (elements.some((element) => element.type && element.type !== "cube")) fail("MODEL_MESH_UNSUPPORTED")
  const groups = readGroups(project, elements)
  const tracks = compileAnimationTracks(project, parsed.design, groups)
  const png = parseTexture(project, parsed.design.texture_size, parsed.design.texture_size)
  const design = ModelDesignSchema.parse({ ...parsed.design, animations: compileNumericAnimations(tracks, parsed.design) })
  const compiled = compileModel(design, identifier)
  // A texture repainted in the editor no longer matches the painter's glow picture, so that picture is dropped with it.
  return applyEditableGeometry(mergeAnimationTracks({ ...compiled, png, glow: Buffer.from(png).equals(Buffer.from(compiled.png)) ? compiled.glow : null }, tracks, identifier), design, groups, elements)
}

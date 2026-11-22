import { createHash } from "node:crypto"
import { z } from "zod"
import { ANIMATION_TRACKS, channelTracks, usesContract2, usesContract3, type Clip } from "@minemods/studio-ai/animation"
import { blockbenchTrackWords } from "./blockbench-keys"
import { decodeRgbaPng } from "./png-decode"

/**
 * A creature's look as a Blockbench project file (.bbmodel), made from the very geometry, animation and
 * texture a build puts in the jar.
 *
 * Format: "Bedrock Entity" (`model_format: "bedrock"`). It is built into Blockbench, so the file opens
 * without any plugin (the GeckoLib format needs the GeckoLib plugin); it has bones, per-face UV and
 * animations; and its conventions are the ones GeckoLib reads, so File → Export → Bedrock Geometry gives
 * back a .geo.json the mod can use. Written as format version 4.10 (nested outliner), which Blockbench 4
 * and 5 both read.
 *
 * Coordinates: a .geo.json mirrors X relative to what Blockbench keeps in a project. This writer applies
 * exactly what Blockbench's own Bedrock importer does (negate X of positions and pivots, negate the X and Y
 * of rotations, turn the up and down faces' UV half a turn), so the model looks in Blockbench as it does in
 * the game. Animation keyframes are stored unchanged: a project file of this version keeps them in the
 * file's convention (Blockbench 5 turns them over itself when it reads a file older than 5.0).
 *
 * Animations: every track the mod's animation file has. When the caller hands over the clips the file was
 * made from (`clips`), a clip that curves or holds is written with its own keys and their interpolation
 * (`smooth` is Blockbench's `catmullrom`), not with the straight pieces the game's file cuts a curve into:
 * the animation contract (studio-ai/animation.ts) is Blockbench's own rule, so it plays there as it does here.
 *
 * `./blockbench.ts` is a different thing: the round trip of Studio's own embedded editor.
 */

const Vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
const FACES = ["north", "east", "south", "west", "up", "down"] as const

const GeometrySchema = z.object({
  "minecraft:geometry": z
    .array(
      z.object({
        description: z.object({ identifier: z.string(), texture_width: z.number().int().positive(), texture_height: z.number().int().positive(), visible_bounds_width: z.number().optional(), visible_bounds_height: z.number().optional(), visible_bounds_offset: Vector.optional() }),
        bones: z.array(
          z.object({
            name: z.string().min(1),
            parent: z.string().optional(),
            pivot: Vector,
            rotation: Vector.optional(),
            cubes: z
              .array(
                z.object({
                  name: z.string().optional(),
                  origin: Vector,
                  size: Vector,
                  pivot: Vector.optional(),
                  rotation: Vector.optional(),
                  inflate: z.number().finite().optional(),
                  uv: z.record(z.string(), z.object({ uv: z.tuple([z.number(), z.number()]), uv_size: z.tuple([z.number(), z.number()]) })),
                }),
              )
              .default([]),
          }),
        ),
      }),
    )
    .length(1),
})
const Channel = z.union([Vector, z.number().finite(), z.record(z.string(), z.unknown())])
const AnimationFileSchema = z.object({
  animations: z.record(
    z.string(),
    z.object({ loop: z.union([z.boolean(), z.string()]).optional(), animation_length: z.number().finite().positive().optional(), bones: z.record(z.string(), z.object({ rotation: Channel.optional(), position: Channel.optional(), scale: Channel.optional() })).default({}) }),
  ),
})

// Blockbench names things by UUID. Derived from what the thing is, so the same model always gives the same file.
const uuid = (seed: string) => {
  const hex = createHash("sha256").update(seed).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
// -0 would be written as 0 anyway; this keeps the object equal to its own JSON.
const flip = (value: number) => (value === 0 ? 0 : -value)

/** One channel of one bone as keyframes in time order. A value that is not three plain numbers is left out. */
function keyframes(seed: string, channel: "rotation" | "position" | "scale", value: z.infer<typeof Channel>) {
  const frames: [number, unknown][] = Array.isArray(value) || typeof value === "number" ? [[0, value]] : Object.entries(value).map(([time, point]) => [Number(time), point])
  return frames
    .flatMap(([time, point]) => {
      // Bedrock allows a keyframe with a value before and after; the one after is what the motion continues with.
      const settled = typeof point === "object" && point !== null && !Array.isArray(point) && "post" in point ? point.post : point
      const vector = Vector.safeParse(typeof settled === "number" ? [settled, settled, settled] : settled)
      return vector.success && Number.isFinite(time) ? [{ time, vector: vector.data }] : []
    })
    .sort((a, b) => a.time - b.time)
    .map((frame) => ({ channel, data_points: [{ x: frame.vector[0], y: frame.vector[1], z: frame.vector[2] }], uuid: uuid(`${seed}/${channel}/${frame.time}`), time: frame.time, color: -1, interpolation: "linear" }))
}

/** One bone's part of a clip as Blockbench keyframes, with the interpolation each key was written with (and, 第 2 步, a bezier key's handles and an easing: `blockbench-keys.ts`). */
function clipKeyframes(seed: string, channel: Clip["channels"][number]) {
  const tracks = channelTracks(channel)
  return ANIMATION_TRACKS.flatMap((track) => {
    const words = blockbenchTrackWords(tracks[track])
    return tracks[track].map((key, index) => ({ channel: track, data_points: [{ x: key.value[0], y: key.value[1], z: key.value[2] }], uuid: uuid(`${seed}/${track}/${key.time}`), time: key.time, color: -1, interpolation: "linear", ...words[index] }))
  })
}

export function exportBbmodel(input: {
  name: string
  geometry: unknown
  animation: unknown
  png: Uint8Array
  /** The clips the animation file was compiled from, by their short names. Left out, keyframes are read back from the animation file. */
  clips?: readonly (Clip & { name: string })[]
  /** The design's names for each bone's cubes, in order: a .geo.json has none, and a named cube is easier to find in Blockbench. */
  cubes?: readonly (readonly string[])[]
}) {
  const geometry = GeometrySchema.parse(input.geometry)["minecraft:geometry"][0]!
  const animation = AnimationFileSchema.parse(input.animation)
  const description = geometry.description
  const identifier = description.identifier.replace(/^geometry\./, "")
  const groups = geometry.bones.map((bone, boneIndex) => ({
    bone,
    uuid: uuid(`${identifier}/bone/${bone.name}`),
    origin: [flip(bone.pivot[0]), bone.pivot[1], bone.pivot[2]] as [number, number, number],
    cubes: bone.cubes.map((cube, cubeIndex) => ({ cube, uuid: uuid(`${identifier}/cube/${boneIndex}/${cubeIndex}`), name: cube.name ?? input.cubes?.[boneIndex]?.[cubeIndex] ?? `${bone.name}_${cubeIndex + 1}` })),
  }))
  const elements = groups.flatMap((group) =>
    group.cubes.map((entry) => {
      const from = [flip(entry.cube.origin[0] + entry.cube.size[0]), entry.cube.origin[1], entry.cube.origin[2]] as [number, number, number]
      return {
        name: entry.name,
        box_uv: false,
        rescale: false,
        locked: false,
        render_order: "default",
        allow_mirror_modeling: true,
        from,
        to: [from[0] + entry.cube.size[0], from[1] + entry.cube.size[1], from[2] + entry.cube.size[2]] as [number, number, number],
        autouv: 0,
        color: 0,
        origin: entry.cube.pivot ? ([flip(entry.cube.pivot[0]), entry.cube.pivot[1], entry.cube.pivot[2]] as [number, number, number]) : group.origin,
        rotation: entry.cube.rotation ? ([flip(entry.cube.rotation[0]), flip(entry.cube.rotation[1]), entry.cube.rotation[2]] as [number, number, number]) : ([0, 0, 0] as [number, number, number]),
        // 第 1 步: an inflated cube keeps its inflate (a mirrored face is already written running backwards in its uv).
        ...(entry.cube.inflate ? { inflate: entry.cube.inflate } : {}),
        faces: Object.fromEntries(
          FACES.flatMap((face) => {
            const rect = entry.cube.uv[face]
            if (!rect) return []
            const box = [rect.uv[0], rect.uv[1], rect.uv[0] + rect.uv_size[0], rect.uv[1] + rect.uv_size[1]] as const
            return [[face, { uv: face === "up" || face === "down" ? [box[2], box[3], box[0], box[1]] : [...box], texture: 0 }]]
          }),
        ),
        type: "cube",
        uuid: entry.uuid,
      }
    }),
  )
  type Node = { name: string; origin: [number, number, number]; rotation: [number, number, number]; color: number; uuid: string; export: boolean; isOpen: boolean; locked: boolean; visibility: boolean; autouv: number; children: (string | Node)[] }
  const node = (group: (typeof groups)[number]): Node => ({
    name: group.bone.name,
    origin: group.origin,
    rotation: group.bone.rotation ? [flip(group.bone.rotation[0]), flip(group.bone.rotation[1]), group.bone.rotation[2]] : [0, 0, 0],
    color: 0,
    uuid: group.uuid,
    export: true,
    isOpen: false,
    locked: false,
    visibility: true,
    autouv: 0,
    children: [...group.cubes.map((entry) => entry.uuid), ...groups.filter((child) => child.bone.parent === group.bone.name).map(node)],
  })
  return {
    meta: { format_version: "4.10", model_format: "bedrock", box_uv: false },
    name: input.name,
    model_identifier: identifier,
    visible_box: [description.visible_bounds_width ?? 8, description.visible_bounds_height ?? 8, description.visible_bounds_offset?.[1] ?? 0],
    variable_placeholders: "",
    variable_placeholder_buttons: [],
    timeline_setups: [],
    unhandled_root_fields: {},
    resolution: { width: description.texture_width, height: description.texture_height },
    elements,
    // A bone whose parent is not in the file is shown at the top rather than lost.
    outliner: groups.filter((group) => !groups.some((parent) => parent.bone.name === group.bone.parent)).map(node),
    textures: [
      {
        path: "",
        name: `${identifier}.png`,
        folder: "",
        namespace: "",
        id: "0",
        width: description.texture_width,
        height: description.texture_height,
        uv_width: description.texture_width,
        uv_height: description.texture_height,
        particle: false,
        render_mode: "default",
        visible: true,
        internal: true,
        saved: false,
        mode: "bitmap",
        uuid: uuid(`${identifier}/texture`),
        source: `data:image/png;base64,${Buffer.from(input.png).toString("base64")}`,
      },
    ],
    animations: Object.entries(animation.animations).map(([name, value]) => {
      // Only a clip that says more than straight lines is worth its own keys; any other reads back from the file exactly as before.
      const clip = input.clips?.find((candidate) => name.endsWith(`.${candidate.name}`) && (usesContract2(candidate) || usesContract3(candidate)) && candidate.channels.every((channel) => channel.bone in value.bones))
      const animators = Object.fromEntries(
        Object.entries(value.bones).flatMap(([boneName, channels]) => {
          const group = groups.find((candidate) => candidate.bone.name === boneName)
          if (!group) return []
          const written = clip?.channels.find((channel) => channel.bone === boneName)
          const frames = written
            ? clipKeyframes(`${identifier}/${name}/${boneName}`, written)
            : (["rotation", "position", "scale"] as const).flatMap((channel) => (channels[channel] === undefined ? [] : keyframes(`${identifier}/${name}/${boneName}`, channel, channels[channel])))
          return [[group.uuid, { name: boneName, type: "bone", keyframes: frames }]]
        }),
      )
      const last = Math.max(0, ...Object.values(animators).flatMap((animator) => animator.keyframes.map((frame) => frame.time)))
      return {
        uuid: uuid(`${identifier}/animation/${name}`),
        // The full name stays: it is the one the mod's code asks GeckoLib for.
        name,
        loop: value.loop === true || value.loop === "loop" ? "loop" : value.loop === "hold_on_last_frame" ? "hold" : "once",
        override: false,
        length: value.animation_length ?? last,
        snapping: 24,
        selected: false,
        anim_time_update: "",
        blend_weight: "",
        start_delay: "",
        loop_delay: "",
        animators,
      }
    }),
  }
}
export type Bbmodel = ReturnType<typeof exportBbmodel>

const Uv = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
const WrittenNode: z.ZodType<{ name: string; origin: number[]; rotation: number[]; uuid: string; children: unknown[] }> = z.lazy(() =>
  z.object({ name: z.string().min(1), origin: Vector, rotation: Vector, uuid: z.string().min(1), children: z.array(z.union([z.string(), WrittenNode])) }),
)
const WrittenSchema = z.object({
  meta: z.object({ format_version: z.string(), model_format: z.literal("bedrock"), box_uv: z.literal(false) }),
  name: z.string().min(1),
  resolution: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  elements: z.array(z.object({ name: z.string().min(1), type: z.literal("cube"), uuid: z.string().min(1), box_uv: z.literal(false), from: Vector, to: Vector, origin: Vector, rotation: Vector, faces: z.record(z.enum(FACES), z.object({ uv: Uv, texture: z.literal(0) })) })),
  outliner: z.array(WrittenNode),
  textures: z.array(z.object({ name: z.string().min(1), source: z.string().startsWith("data:image/png;base64,"), width: z.number().int().positive(), height: z.number().int().positive(), uv_width: z.number().int().positive(), uv_height: z.number().int().positive() })).length(1),
  animations: z.array(
    z.object({
      name: z.string().min(1),
      uuid: z.string().min(1),
      loop: z.enum(["loop", "once", "hold"]),
      length: z.number().finite().min(0),
      animators: z.record(
        z.string(),
        z.object({ name: z.string().min(1), type: z.literal("bone"), keyframes: z.array(z.object({ channel: z.enum(["rotation", "position", "scale"]), time: z.number().finite().min(0), uuid: z.string().min(1), interpolation: z.enum(["linear", "step", "catmullrom", "bezier"]).optional(), data_points: z.array(z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() })).length(1) })) }),
      ),
    }),
  ),
})

/**
 * Structural check of a written file, in place of opening it: every problem found, none when it is sound.
 * It reads the file as plain data, so it also checks a file that went to disk and back.
 */
export function checkBbmodel(input: unknown): string[] {
  const parsed = WrittenSchema.safeParse(input)
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
  const model = parsed.data
  const walk = (nodes: unknown[], parent: string | null): { uuid: string; name: string; parent: string | null; cubes: string[] }[] =>
    nodes.flatMap((value) => {
      const entry = WrittenNode.safeParse(value)
      if (!entry.success) return []
      return [{ uuid: entry.data.uuid, name: entry.data.name, parent, cubes: entry.data.children.filter((child): child is string => typeof child === "string") }, ...walk(entry.data.children, entry.data.uuid)]
    })
  const groups = walk(model.outliner, null)
  const placed = groups.flatMap((group) => group.cubes)
  const texture = model.textures[0]!
  const picture = (() => {
    try {
      return decodeRgbaPng(Buffer.from(texture.source.slice("data:image/png;base64,".length), "base64"))
    } catch {
      return null
    }
  })()
  const ids = [...groups.map((group) => group.uuid), ...model.elements.map((element) => element.uuid), ...model.animations.map((animation) => animation.uuid)]
  return [
    ...(new Set(ids).size === ids.length ? [] : ["two things share a UUID"]),
    ...(new Set(groups.map((group) => group.name)).size === groups.length ? [] : ["two bones share a name"]),
    ...(model.outliner.some((value) => typeof value === "string") ? ["a cube lies outside every bone"] : []),
    ...model.elements.flatMap((element) => [
      ...(placed.filter((id) => id === element.uuid).length === 1 ? [] : [`cube ${element.name} is not in exactly one bone`]),
      ...(element.from.every((value, axis) => value < element.to[axis]!) ? [] : [`cube ${element.name} has no size on some axis`]),
      ...FACES.flatMap((face) => {
        const uv = element.faces[face]?.uv
        if (!uv) return [`cube ${element.name} has no ${face} face`]
        const inside = Math.min(uv[0], uv[2]) >= 0 && Math.min(uv[1], uv[3]) >= 0 && Math.max(uv[0], uv[2]) <= model.resolution.width && Math.max(uv[1], uv[3]) <= model.resolution.height
        return [...(inside ? [] : [`cube ${element.name} ${face} UV leaves the texture`]), ...(uv[0] !== uv[2] && uv[1] !== uv[3] ? [] : [`cube ${element.name} ${face} UV is empty`])]
      }),
    ]),
    ...placed.filter((id) => !model.elements.some((element) => element.uuid === id)).map((id) => `the outliner names a cube that does not exist: ${id}`),
    ...(picture ? [] : ["the embedded texture is not a readable PNG"]),
    ...(picture && (picture.width !== model.resolution.width || picture.height !== model.resolution.height) ? ["the embedded texture is not the size the file says"] : []),
    ...(texture.width === model.resolution.width && texture.height === model.resolution.height && texture.uv_width === model.resolution.width && texture.uv_height === model.resolution.height ? [] : ["the texture record and the resolution disagree"]),
    ...model.animations.flatMap((animation) =>
      Object.entries(animation.animators).flatMap(([id, animator]) => [
        ...(groups.some((group) => group.uuid === id && group.name === animator.name) ? [] : [`animation ${animation.name} moves a bone that is not in the model: ${animator.name}`]),
        ...(["rotation", "position", "scale"] as const).flatMap((channel) => {
          const times = animator.keyframes.filter((frame) => frame.channel === channel).map((frame) => frame.time)
          return [
            ...(times.every((time, index) => index === 0 || time > times[index - 1]!) ? [] : [`animation ${animation.name}, ${animator.name} ${channel}: keyframe times do not increase`]),
            ...(times.every((time) => time <= animation.length + 1e-9) ? [] : [`animation ${animation.name}, ${animator.name} ${channel}: a keyframe lies after the end`]),
          ]
        }),
      ]),
    ),
  ]
}

/** The text of a .bbmodel file; refuses to write one that fails its own structural check. */
export function bbmodelText(input: Parameters<typeof exportBbmodel>[0]) {
  const model = exportBbmodel(input)
  const problems = checkBbmodel(JSON.parse(JSON.stringify(model)))
  if (problems.length) throw new Error(`BBMODEL_INVALID:${problems.slice(0, 5).join("; ")}`)
  return JSON.stringify(model)
}

/** A file name a creature's model can be saved under on any system, never empty, never two alike in one list. */
export function bbmodelNames(names: readonly string[]) {
  return names.reduce<string[]>((taken, name) => {
    const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 60) || "model"
    const free = [base, ...Array.from({ length: taken.length + 1 }, (_, index) => `${base}-${index + 2}`)].find((candidate) => !taken.includes(`${candidate}.bbmodel`))!
    return [...taken, `${free}.bbmodel`]
  }, [])
}

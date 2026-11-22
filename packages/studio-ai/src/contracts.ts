import { z } from "zod"
import { ModelAnnotationImageSchema } from "./model-annotation"
import { ANIMATION_LIMITS, BLEND_MOST, EASINGS, FOLLOW_RANGE, FOOT_RANGE, HANG_ONLY, HANG_RANGE, hangs, INTERPOLATIONS, SPRING_ONLY } from "./animation"
import { ModelComplexitySchema } from "./model-quality"
import { budgetFaults, GEOMETRY_TIER_IDS, LEGACY_TEXTURE, TEXTURE_SIZES, TIER_CEILING, textureSizes, tierOf } from "./budget"
import { faceSize, modelAtlas, texelOf } from "./model-paint"
import { boneTip } from "./pose-rig"

const NameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/)
const PositionSchema = z.tuple([
  z.number().min(-256).max(256),
  z.number().min(-256).max(256),
  z.number().min(-256).max(256),
])
const RotationSchema = z.tuple([
  z.number().min(-360).max(360),
  z.number().min(-360).max(360),
  z.number().min(-360).max(360),
])
// The animation contract (see animation.ts). Version 1 keys carry a time and a rotation; everything else is
// optional and nullable, so a version 1 document parses to itself and strict JSON-schema callers can send null.
const InterpolationSchema = z.enum(INTERPOLATIONS).nullable().optional()
const KeyTimeSchema = z.number().min(0).max(30)
const offset = (limit: number, low = -limit) => z.tuple([z.number().min(low).max(limit), z.number().min(low).max(limit), z.number().min(low).max(limit)])
// Version 3 (animation.ts): an easing for the straight line that leaves a key, and Blockbench's Bézier handles. Seconds out from the key, and
// a value above it in the track's own unit; a handle is held inside its segment when played, so any time up to the longest clip is accepted.
const HandleTime = (low: number, high: number) => z.tuple([z.number().min(low).max(high), z.number().min(low).max(high), z.number().min(low).max(high)]).nullable().optional()
const keyCurve = (limit: number) => ({
  easing: z.enum(EASINGS).nullable().optional(),
  bezier_left_time: HandleTime(-30, 0),
  bezier_left_value: offset(limit * 2).nullable().optional(),
  bezier_right_time: HandleTime(0, 30),
  bezier_right_value: offset(limit * 2).nullable().optional(),
})
export const AnimationChannelSchema = z.strictObject({
  bone: NameSchema,
  /** Rotation keys: degrees added to the bone's built angles. May be empty when the bone only moves or scales. */
  keyframes: z.array(z.strictObject({ time: KeyTimeSchema, rotation: RotationSchema, interpolation: InterpolationSchema, ...keyCurve(ANIMATION_LIMITS.rotation) })).max(ANIMATION_LIMITS.keys),
  /** Position keys: model pixels the bone is moved by, along the axes of the bone above it. */
  position: z.array(z.strictObject({ time: KeyTimeSchema, position: offset(ANIMATION_LIMITS.position), interpolation: InterpolationSchema, ...keyCurve(ANIMATION_LIMITS.position) })).max(ANIMATION_LIMITS.keys).nullable().optional(),
  /** Scale keys: multipliers about the bone's pivot; 1 is the built size. */
  scale: z.array(z.strictObject({ time: KeyTimeSchema, scale: offset(ANIMATION_LIMITS.scale, 0), interpolation: InterpolationSchema, ...keyCurve(ANIMATION_LIMITS.scale) })).max(ANIMATION_LIMITS.keys).nullable().optional(),
})
/** The clip words of version 3 (animation.ts `Clip`): ticks it blends in and out over, and whether the walk and the idle keep the bones it does not key. */
const weightKeys = z.array(z.strictObject({ time: KeyTimeSchema, value: z.number().min(0).max(1) })).min(1).max(8).nullable().optional()
export const ClipBlendSchema = {
  display_name: z.string().trim().min(1).max(120).optional(),
  weights: z.strictObject({ look: weightKeys, sway: weightKeys, follow: weightKeys, hang: weightKeys }).nullable().optional(),
  blend: z.number().int().min(0).max(BLEND_MOST).nullable().optional(),
  layered: z.boolean().nullable().optional(),
}
/** A model's follow bones (animation.ts `FollowBone`): each named once, each a bone of the model (checked with the bones). */
export const FollowSchema = z
  .array(
    z.strictObject({
      bone: NameSchema,
      period: z.number().min(FOLLOW_RANGE.period[0]).max(FOLLOW_RANGE.period[1]).nullable().optional(),
      damping: z.number().min(FOLLOW_RANGE.damping[0]).max(FOLLOW_RANGE.damping[1]).nullable().optional(),
      drag: z.number().min(FOLLOW_RANGE.drag[0]).max(FOLLOW_RANGE.drag[1]).nullable().optional(),
      limit: z.number().min(FOLLOW_RANGE.limit[0]).max(FOLLOW_RANGE.limit[1]).nullable().optional(),
      /** The least and the most sway on x, in place of `limit` there (a cape on a back: [0, 60]). */
      // An array of two, not a tuple: the strict JSON schema writes every tuple of this document as three numbers.
      x_range: z.array(z.number().min(-90).max(90)).length(2).nullable().optional(),
      /** 第 2 步 (挂链): spring (as before) or hang; the words after it are the hanging chain's, written on its top link. */
      mode: z.enum(["spring", "hang"]).nullable().optional(),
      gravity: z.number().min(HANG_RANGE.gravity[0]).max(HANG_RANGE.gravity[1]).nullable().optional(),
      attract: z.number().min(HANG_RANGE.attract[0]).max(HANG_RANGE.attract[1]).nullable().optional(),
      falloff: z.number().min(HANG_RANGE.falloff[0]).max(HANG_RANGE.falloff[1]).nullable().optional(),
      floor: z.boolean().nullable().optional(),
      weight: z.number().min(HANG_RANGE.weight[0]).max(HANG_RANGE.weight[1]).nullable().optional(),
    }),
  )
  .max(FOLLOW_RANGE.bones)
  .nullable()
  .optional()
/** 第 2 步 (踩地): a model's feet on the ground (animation.ts `FootPlacement`); its bones are checked with the bones. */
export const FootPlacementSchema = z
  .strictObject({
    feet: z
      .array(
        z.strictObject({
          thigh: NameSchema,
          calf: NameSchema.nullable().optional(),
          foot: NameSchema.nullable().optional(),
          forward: z.number().min(-FOOT_RANGE.probe).max(FOOT_RANGE.probe).nullable().optional(),
          side: z.number().min(-FOOT_RANGE.probe).max(FOOT_RANGE.probe).nullable().optional(),
          knee: z.enum(["forward", "back"]).nullable().optional(),
        }),
      )
      .min(1)
      .max(FOOT_RANGE.feet),
    body: NameSchema.nullable().optional(),
    rise_speed: z.number().min(FOOT_RANGE.speed[0]).max(FOOT_RANGE.speed[1]).nullable().optional(),
    fall_speed: z.number().min(FOOT_RANGE.speed[0]).max(FOOT_RANGE.speed[1]).nullable().optional(),
    max_drop: z.number().min(FOOT_RANGE.max_drop[0]).max(FOOT_RANGE.max_drop[1]).nullable().optional(),
  })
  .nullable()
  .optional()
export type AnimationChannel = z.infer<typeof AnimationChannelSchema>

/** What a clip's channels must satisfy beyond their shape; each problem is handed to `issue` with the path inside `channels`. */
export function checkAnimationChannels(channels: readonly AnimationChannel[], length: number, issue: (message: string, path: (string | number)[]) => void) {
  if (new Set(channels.map((channel) => channel.bone)).size !== channels.length) issue("Animation channels must be unique", [])
  channels.forEach((channel, channelIndex) => {
    const tracks = [["keyframes", channel.keyframes], ["position", channel.position ?? []], ["scale", channel.scale ?? []]] as const
    if (tracks.every((track) => track[1].length === 0)) issue("An animation channel needs at least one key", [channelIndex])
    tracks.forEach(([name, keys]) => {
      // A time a hair past the end is the end: scripts add steps of 0.05 and arrive at 1.2000000000000002 (met in two real runs).
      // One millionth of a second is far below one game tick (0.05 s) and well above what such sums are off by.
      if (keys.some((frame, index) => frame.time > length + 1e-6 || (index > 0 && frame.time <= keys[index - 1]!.time)))
        issue("Keyframe times must increase and stay within animation length", [channelIndex, name])
    })
  })
}

const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const SurfaceDetailSchema = z.strictObject({
  face: z.enum(["north", "east", "south", "west", "up", "down"]),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  color: ColorSchema,
})

/** Surface materials the painter knows how to draw in a few clustered tones. */
export const MODEL_MATERIALS = [
  "skin", "fur", "feather", "scales", "shell", "stone", "crystal", "metal", "wood", "cloth", "bone", "slime", "leaf", "leather",
] as const
/** Marks placed by meaning on a cube face; the painter decides the pixels. */
export const MODEL_FEATURES = [
  "eyes", "mouth", "nose", "brows", "belly", "stripes", "spots", "cracks", "veins", "band", "claws", "gem",
] as const
export const MODEL_FEATURE_SHAPES = [
  "dot", "wide", "tall", "square", "slit", "line", "smile", "frown", "open", "fangs", "teeth", "snout",
  "flat", "angry", "sad", "bands", "long", "ring", "frame", "diamond",
] as const

// Every optional field is also nullable: strict JSON-schema callers must send all keys and use null for "default".
const PaintSchema = z.strictObject({
  material: z.enum(MODEL_MATERIALS),
  base: ColorSchema,
  secondary: ColorSchema.nullable().optional(),
  /** 第 1 步: how worn the surface is under `shading: "rich"`, 0 new to 1 battered (rust on metal, chips on stone, fraying on cloth…); absent: 0.35. */
  wear: z.number().min(0).max(1).nullable().optional(),
})
const FeatureSchema = z.strictObject({
  type: z.enum(MODEL_FEATURES),
  face: z.enum(["north", "east", "south", "west", "up", "down", "sides", "all"]).nullable().optional(),
  shape: z.enum(MODEL_FEATURE_SHAPES).nullable().optional(),
  color: ColorSchema.nullable().optional(),
  color2: ColorSchema.nullable().optional(),
  x: z.number().min(0).max(1).nullable().optional(),
  y: z.number().min(0).max(1).nullable().optional(),
  size: z.number().int().min(1).max(16).nullable().optional(),
  count: z.number().int().min(1).max(16).nullable().optional(),
  glow: z.boolean().nullable().optional(),
  mirror: z.boolean().nullable().optional(),
})
export type ModelPaint = z.infer<typeof PaintSchema>
export type ModelFeature = z.infer<typeof FeatureSchema>

// 第 1 步: a cube's angles, pivot and other refinements beyond its box. Every one is optional and nullable,
// and a cube that says none of them is the cube it always was, compiled byte for byte as before.
const FACE_NAMES = ["north", "east", "south", "west", "up", "down"] as const
/** A face's own pixels: `data` is the face row by row (left to right, top to bottom, as the face is seen), each an index into `palette`. */
const FacePixelsSchema = z.strictObject({ palette: z.array(ColorSchema).min(1).max(256), data: z.array(z.number().int().min(0).max(255)).min(1) })
/** The most face pixels one model may carry in all (`pixels`): a 1024 texture's worth of faces is far more than any face needs its own pixels for. */
export const FACE_PIXEL_LIMIT = 400_000
const CUBE_SHAPE = {
  /** Degrees the cube is turned about `pivot`, as a bone's rotation is (x, then y, then z): what makes an angled plate. Free angles, as GeckoLib's geometry takes them. */
  rotation: z.tuple([z.number().min(-180).max(180), z.number().min(-180).max(180), z.number().min(-180).max(180)]).nullable().optional(),
  /** The point the cube turns about, in model pixels; absent: the middle of the cube. */
  pivot: PositionSchema.nullable().optional(),
  /** Model pixels the cube is grown by on every side without changing its texture (a skin over a part, a slightly larger plate on a joint). */
  inflate: z.number().min(-2).max(4).nullable().optional(),
  /** The cube's texture drawn mirrored left to right (and east and west swapped): the other side of a symmetric pair. */
  mirror: z.boolean().nullable().optional(),
  /**
   * "bone.cube": this cube wears the texture of that cube (same size) instead of taking space of its own on the texture: a right arm that
   * shares the left arm's texels (with `mirror`), twelve teeth that are one. Its own paint, features, details and pixels are not drawn.
   */
  share: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,47}\.[a-zA-Z][a-zA-Z0-9_]{0,47}$/).nullable().optional(),
  /** A face's own pixels, drawn in place of its paint (tiers with `face_pixels`: 最精细 and 史诗). */
  pixels: z.partialRecord(z.enum(FACE_NAMES), FacePixelsSchema).nullable().optional(),
}

/** The three motions a generated creature always plays (`mod-core/fabric/entity.ts`): what a creature's model has to carry, and nothing else has to. */
export const CREATURE_CLIPS = ["idle", "walk", "hurt"] as const

/**
 * A model document's shape and its own structural rules. `creature`: it is a creature's model, which also has to
 * carry `CREATURE_CLIPS`; without, it is the same shape for something no creature wears (an effect), which has only
 * the motions it plays itself. One definition, so the two cannot drift apart.
 */
const modelSchema = (creature: boolean, least = creature ? CREATURE_CLIPS.length : 1) =>
  z
  .strictObject({
    name: z.string().min(1).max(80),
    texture_size: z.union(TEXTURE_SIZES.map((size) => z.literal(size))),
    /**
     * How many model pixels one texel covers along each side (`texelOf`): absent, null or 1, one texel per model pixel as always. 2 or 4 only for a model the largest
     * texture its tier allows cannot hold at the density below (checked below): faces, features and surface details are then all counted in texels.
     */
    texel_size: z.union([z.literal(1), z.literal(2), z.literal(4)]).nullable().optional(),
    /**
     * 第 1 步: "rich" paints every face the way a hand-painted boss is: light by the way the face points, a lit top edge and a dark lower one,
     * darker where a face meets another part, the material's own grain and wear, a gradient down each side. Absent, null or "flat": as always.
     */
    shading: z.enum(["flat", "rich"]).nullable().optional(),
    /** 第 1 步: "packed" lays the faces on the texture tallest first, so far less of it is left empty; absent, null or "rows": in document order, as always. */
    atlas: z.enum(["rows", "packed"]).nullable().optional(),
    /**
     * The geometry tier this model is held to (`budget.ts`). Absent or null: the default tier, which is exactly
     * what every document was held to before tiers. The array bounds below are the highest tier's; what
     * this model's own tier allows is checked, and said in words, further down.
     */
    budget: z.enum(GEOMETRY_TIER_IDS).nullable().optional(),
    bones: z
      .array(
        z.strictObject({
          name: NameSchema,
          parent: NameSchema.nullable(),
          pivot: PositionSchema,
          rotation: RotationSchema,
          /** Material for every cube of this bone and of the bones below it, unless they name their own. */
          paint: PaintSchema.nullable().optional(),
          cubes: z
            .array(
              z.strictObject({
                name: NameSchema,
                origin: PositionSchema,
                size: z.tuple([
                  z.number().int().min(1).max(256),
                  z.number().int().min(1).max(256),
                  z.number().int().min(1).max(256),
                ]),
                faces: z.strictObject({
                  north: ColorSchema,
                  east: ColorSchema,
                  south: ColorSchema,
                  west: ColorSchema,
                  up: ColorSchema,
                  down: ColorSchema,
                }),
                surface_details: z.array(SurfaceDetailSchema).max(64).default([]),
                paint: PaintSchema.nullable().optional(),
                features: z.array(FeatureSchema).max(12).nullable().optional(),
                ...CUBE_SHAPE,
              }),
            )
            .max(TIER_CEILING.bone_cubes),
        }),
      )
      .min(1)
      .max(TIER_CEILING.bones),
    animations: z
      .array(
        z.strictObject({
          name: NameSchema,
          length: z.number().positive().max(30),
          loop: z.boolean(),
          channels: z
            .array(AnimationChannelSchema)
            .min(1)
            .max(TIER_CEILING.bones),
          ...ClipBlendSchema,
        }),
      )
      .min(least)
      .max(TIER_CEILING.animations),
    look: z.strictObject({
      speed: z.number().min(30).max(720).nullable().optional(),
      bones: z.array(z.strictObject({
        bone: NameSchema, share: z.number().min(0).max(1),
        yaw: z.number().min(0).max(90), pitch: z.number().min(0).max(60),
      })).min(1).max(6),
    }).nullable().optional(),
    sway: z.array(z.strictObject({
      bones: z.array(NameSchema).min(1).max(8),
      axis: z.enum(["x", "y", "z"]),
      channel: z.enum(["rotation", "position", "scale"]).nullable().optional(),
      speed: z.number().min(0.05).max(4),
      amount: z.number().min(0.005).max(45),
      phase: z.number().min(0).max(180).nullable().optional(),
      grow: z.number().min(0.5).max(2).nullable().optional(),
    }).superRefine((s, ctx) => {
      const [min, max] = s.channel === "scale" ? [0.005, 0.2] as const : s.channel === "position" ? [0.1, 8] as const : [0.5, 45] as const
      if (s.amount < min || s.amount > max) ctx.addIssue({ code: "custom", path: ["amount"], message: `这种摆动的幅度须在 ${min} 到 ${max} 之间。` })
    })).max(8).nullable().optional(),
    follow: FollowSchema,
    foot_placement: FootPlacementSchema,
  })
  .superRefine((design, ctx) => {
    const names = new Set(design.bones.map((bone) => bone.name))
    const bones = new Map(design.bones.map((bone) => [bone.name, bone]))
    const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: "custom", message, path })
    if (names.size !== design.bones.length) issue("Bone names must be unique")
    if (design.bones.filter((bone) => bone.parent === null).length !== 1) issue("Exactly one root bone is required")
    if (!design.bones.some((bone) => bone.cubes.length)) issue("At least one cube is required")
    // Over its tier: refused whole, each limit named with how far over it is. Nothing is cut down to fit.
    budgetFaults(design).forEach((fault) => issue(fault.words, fault.limit === "texture" ? ["texture_size"] : fault.limit === "animations" || fault.limit === "keys" || fault.limit === "total_keys" ? ["animations"] : ["bones"]))
    // A coarser texture only where a finer one cannot hold the model: every step halves the detail a face can carry.
    const texel = texelOf(design)
    if (texel > 1) {
      // Measured against 512 unless the model is itself 1024 (第 1 步): a model saved with texel_size 2 at 512 before 1024 existed stays valid.
      const largest = Math.max(...textureSizes(design.budget).filter((size) => design.texture_size > LEGACY_TEXTURE || size <= LEGACY_TEXTURE))
      const finer = texel / 2
      const holds = (() => {
        try {
          modelAtlas({ ...design, texture_size: largest, texel_size: finer } as never)
          return true
        } catch {
          return false
        }
      })()
      if (holds)
        issue(`texel_size ${texel} 用不着：一个贴图像素盖 ${finer} 个模型像素时，${largest}×${largest} 的贴图已经放得下这个模型。只有最大的贴图也放不下的巨型模型才用它——每大一级，每个面能画的细节少到四分之一。把 texel_size 改成 ${finer === 1 ? "1（或者不写）" : finer}，texture_size 写 ${largest}。`, ["texel_size"])
    }
    design.bones.forEach((bone, boneIndex) => {
      const visited = new Set<string>([bone.name])
      const walk = (parent: string | null): void => {
        if (parent === null) return
        if (visited.has(parent)) return issue("Bone hierarchy must be acyclic")
        const ancestor = bones.get(parent)
        if (!ancestor) return issue("Bone parent must exist")
        visited.add(parent)
        walk(ancestor.parent)
      }
      walk(bone.parent)
      if (new Set(bone.cubes.map((cube) => cube.name)).size !== bone.cubes.length)
        issue(`Cube names must be unique within bone ${bone.name}`, ["bones", boneIndex, "cubes"])
      bone.cubes.forEach((cube, cubeIndex) => {
        if (cube.origin.some((value, axis) => value + cube.size[axis] > 256))
          issue("Cube bounds must stay within 256 units")
        // In texels: at more than one model pixel to a texel a face has fewer of them than model pixels.
        const faceSizes = Object.fromEntries((["north", "east", "south", "west", "up", "down"] as const).map((face) => [face, faceSize(cube.size, face, texel)])) as Record<"north" | "east" | "south" | "west" | "up" | "down", [number, number]>
        if (cube.surface_details.reduce((area, detail) => area + detail.width * detail.height, 0) > 4096)
          issue("Surface details must cover at most 4096 pixels per cube")
        cube.surface_details.forEach((detail, detailIndex) => {
          const size = faceSizes[detail.face]
          if (detail.x + detail.width > size[0] || detail.y + detail.height > size[1])
            issue(`Surface detail must stay within the ${size[0]}x${size[1]} ${detail.face} face of ${bone.name}.${cube.name}`, ["bones", boneIndex, "cubes", cubeIndex, "surface_details", detailIndex])
        })
      })
    })
    cubeShapeIssues(design, texel, issue)
    const animationNames = new Set(design.animations.map((animation) => animation.name))
    // A creature's model also has to carry the three motions the generated creature always plays; a shape that is not a creature's (an effect) has only its own.
    if (animationNames.size !== design.animations.length || (creature && !CREATURE_CLIPS.every((name) => animationNames.has(name))))
      issue(creature ? "Idle, walk and hurt animations are required" : "Animation names must be unique")
    design.animations.forEach((animation, animationIndex) => {
      animation.channels.forEach((channel, channelIndex) => {
        if (!names.has(channel.bone)) issue(`Animation bone ${channel.bone} must exist`, ["animations", animationIndex, "channels", channelIndex, "bone"])
      })
      for (const [layer, keys] of Object.entries(animation.weights ?? {})) {
        if (!keys?.length) continue
        const path = ["animations", animationIndex, "weights", layer]
        if (animation.loop && keys.length > 1) issue(`${animation.name} 是循环动作，${layer} 权重只能写一个点。`, path)
        keys.forEach((key, i) => {
          if (key.time > animation.length || (i > 0 && key.time <= keys[i - 1]!.time))
            issue("权重点按时间从小到大写，同一时刻只写一次，时间不能超过动作时长。", [...path, i, "time"])
        })
      }
      checkAnimationChannels(animation.channels, animation.length, (message, path) => issue(message, path.length ? ["animations", animationIndex, "channels", ...path] : []))
    })
    // Follow bones: each a bone of the model, named once; the root carries the whole body and does not sway after itself.
    ;(design.follow ?? []).forEach((follow, followIndex) => {
      if (!names.has(follow.bone)) issue(`follow 里的骨骼 ${follow.bone} 不存在`, ["follow", followIndex, "bone"])
      else if (bones.get(follow.bone)!.parent === null) issue(`follow 里的骨骼 ${follow.bone} 是根骨骼，它没有上一级可以跟着晃；写它下面的骨骼`, ["follow", followIndex, "bone"])
      if ((design.follow ?? []).findIndex((other) => other.bone === follow.bone) !== followIndex) issue(`follow 里的骨骼 ${follow.bone} 写了两次`, ["follow", followIndex, "bone"])
    })
    poseIssues(design, issue)
  })

/** The words of `words` an entry writes (neither left out nor null). */
const writtenOf = (entry: Record<string, unknown>, words: readonly string[]) => words.filter((word) => entry[word] !== undefined && entry[word] !== null)

/**
 * 第 2 步 (挂链和踩地): what hanging chains (`mode: "hang"`) and `foot_placement` must satisfy beyond their shape, said in the words their maker
 * reads. A follow bone that does not exist, or is the root, is refused by the follow check already.
 */
function poseIssues(design: Pick<ModelDesign, "bones" | "sway" | "look"> & { follow?: z.infer<typeof FollowSchema>; foot_placement?: z.infer<typeof FootPlacementSchema> }, issue: (message: string, path?: (string | number)[]) => void) {
  const bones = new Map(design.bones.map((bone) => [bone.name, bone]))
  const follow = design.follow ?? []
  const hanging = new Set(follow.filter(hangs).map((entry) => entry.bone))
  const ancestors = (name: string) => {
    const found: string[] = []
    for (let at = bones.get(name)?.parent ?? null; at && !found.includes(at); at = bones.get(at)?.parent ?? null) found.push(at)
    return found
  }
  follow.forEach((entry, index) => {
    const bone = bones.get(entry.bone)
    if (!bone || bone.parent === null) return
    if (hangs(entry)) {
      const spring = writtenOf(entry, SPRING_ONLY)
      if (spring.length) issue(`follow 里的 ${entry.bone} 是挂着的（mode: "hang"），${spring.join("、")} 只给会弹的（spring）用；挂着的骨骼用 gravity、attract、falloff、damping、limit、floor、weight`, ["follow", index])
      const chainWords = writtenOf(entry, [...HANG_ONLY, "damping", "limit"])
      if (hanging.has(bone.parent) && chainWords.length) {
        const top = ancestors(entry.bone).filter((name) => hanging.has(name)).at(-1)!
        issue(`${entry.bone} 挂在 ${bone.parent} 下面，和它是同一串；整串的 ${chainWords.join("、")} 写在这一串最上面那一节 ${top} 上，下面几节只写 bone 和 mode`, ["follow", index])
      }
      const below = follow.filter((other) => hangs(other) && bones.get(other.bone)?.parent === entry.bone).map((other) => other.bone)
      if (below.length > 1) issue(`挂着的 ${entry.bone} 下面直接挂着 ${below.join("、")} 好几节；一串只能一节接一节往下挂，分开的几串要各自从一根不挂的骨骼下面开始`, ["follow", index])
      const next = below.length === 1 ? bones.get(below[0]!) : undefined
      if (next && Math.hypot(...next.pivot.map((value, axis) => value - bone.pivot[axis]!)) < 0.5)
        issue(`挂着的 ${entry.bone} 和下一节 ${next.name} 的轴点几乎在同一个地方，这一节量不出长度；下一节的轴点要放在上一节的末端`, ["follow", index])
      if (!below.length && !hanging.has(bone.parent) && !boneTip(design, design.bones.indexOf(bone)))
        issue(`挂着的 ${entry.bone} 量不出往哪个方向垂：它下面没有挂着的下一节，它自己的方块又围着它的轴点（或者没有方块）；轴点要放在它挂起来的那一端（比如尾巴根），方块往垂下去的方向伸`, ["follow", index])
    } else {
      const hang = writtenOf(entry, HANG_ONLY)
      if (hang.length) issue(`follow 里的 ${entry.bone} 没有写 mode: "hang"，${hang.join("、")} 只有挂着的骨骼才用；要它挂着垂下来就写 mode: "hang"`, ["follow", index])
      const above = ancestors(entry.bone).find((name) => hanging.has(name))
      if (above) issue(`${entry.bone} 会弹（spring），可它在挂着的 ${above} 下面；挂链下面的骨骼要么也写 mode: "hang"，要么不写进 follow`, ["follow", index])
    }
  })
  const placement = design.foot_placement
  const legs = new Set(placement?.feet.flatMap(foot => [foot.thigh, foot.calf, foot.foot]) ?? [])
  const chainIssue = (name: string, previous: string | undefined, path: (string | number)[], checkLeg: boolean) => {
    if (!bones.has(name)) issue(`骨骼 ${name} 不存在，请写模型里的骨骼名。`, path)
    else if (previous && !ancestors(name).includes(previous)) issue(`${name} 不在上一节 ${previous} 下面，请从根到梢一节接一节写。`, path)
    if (checkLeg && legs.has(name)) issue(`${name} 已经是踩地的腿，两样会抢同一根骨骼。请换一根骨骼。`, path)
  }
  const gaze = design.look?.bones ?? []
  const share = gaze.reduce((sum, bone) => sum + bone.share, 0)
  if (share > 1 + 1e-12) issue(`看向各节 share 加起来是 ${share}，请改到不超过 1。`, ["look", "bones"])
  gaze.forEach(({bone}, i) => chainIssue(bone, gaze[i - 1]?.bone, ["look", "bones", i, "bone"], true))
  const supports = new Set(placement?.feet.flatMap(foot => ancestors(foot.thigh)) ?? [])
  design.sway?.forEach((chain, i) => chain.bones.forEach((name, j) => {
    chainIssue(name, chain.bones[j - 1], ["sway", i, "bones", j], chain.channel !== "scale")
    if (supports.has(name)) issue(`摆动的 ${name} 托着踩地的腿，会带走脚底。把呼吸或摆动放在独立的胸廓、耳朵或尾巴骨上。`, ["sway", i, "bones", j])
  }))
  if (!placement) return
  const followed = new Set(follow.map((entry) => entry.bone))
  const used = new Set<string>()
  const known = (name: string, path: (string | number)[], role: string) => {
    if (!bones.has(name)) {
      issue(`foot_placement 的${role} ${name} 不存在`, ["foot_placement", ...path])
      return false
    }
    if (followed.has(name)) issue(`${name} 写在 follow 里了，又当 foot_placement 的${role}；两样会抢着转它，只能选一样`, ["foot_placement", ...path])
    return true
  }
  if (placement.body) known(placement.body, ["body"], "身体（body）")
  placement.feet.forEach((foot, index) => {
    const path = ["feet", index]
    ;[foot.thigh, foot.calf, foot.foot].forEach((name) => {
      if (!name) return
      if (used.has(name) || name === placement.body) issue(`foot_placement 里 ${name} 用了两次：每根骨骼只能是一条腿的一节，或者是身体`, ["foot_placement", ...path])
      used.add(name)
    })
    if (!known(foot.thigh, [...path, "thigh"], "大腿（thigh）")) return
    if (bones.get(foot.thigh)!.parent === null) return issue(`foot_placement 的 thigh ${foot.thigh} 是根骨骼，整只都挂在它上面，不能当腿`, ["foot_placement", ...path, "thigh"])
    if (placement.body && ancestors(placement.body).includes(foot.thigh)) issue(`foot_placement 的 body ${placement.body} 在腿 ${foot.thigh} 下面；body 要写腿上面的那根（身体或者骨盆）`, ["foot_placement", "body"])
    if (foot.calf && known(foot.calf, [...path, "calf"], "小腿（calf）") && !ancestors(foot.calf).includes(foot.thigh)) issue(`foot_placement 的小腿 ${foot.calf} 不在大腿 ${foot.thigh} 下面；calf 要是 thigh 下面的骨骼`, ["foot_placement", ...path, "calf"])
    const above = foot.calf ?? foot.thigh
    if (foot.foot && known(foot.foot, [...path, "foot"], "脚（foot）") && !ancestors(foot.foot).includes(above)) issue(`foot_placement 的脚 ${foot.foot} 不在 ${above} 下面；foot 要是腿最下面一节下面的骨骼`, ["foot_placement", ...path, "foot"])
    if (!foot.foot && bones.has(above) && !boneTip(design, design.bones.findIndex((bone) => bone.name === above)))
      issue(`foot_placement 的 ${above} 量不出脚踩地的那一点：它没有方块，或者方块围着它的轴点；写 foot（脚掌，轴点放在脚踝），或者把 ${above} 的轴点放在关节上、方块往下伸`, ["foot_placement", ...path])
  })
}


type ShapedCube = { name: string; size: readonly number[]; surface_details: readonly unknown[]; features?: readonly unknown[] | null; share?: string | null; pixels?: Partial<Record<(typeof FACE_NAMES)[number], { palette: readonly string[]; data: readonly number[] }>> | null }

/** 第 1 步: what a cube's `share` and `pixels` must satisfy, said in the words its maker reads. */
function cubeShapeIssues(design: { budget?: Parameters<typeof tierOf>[0]; bones: readonly { name: string; cubes: readonly ShapedCube[] }[] }, texel: number, issue: (message: string, path?: (string | number)[]) => void) {
  const tier = tierOf(design.budget)
  const cubes = new Map<string, ShapedCube>(design.bones.flatMap((bone) => bone.cubes.map((cube) => [`${bone.name}.${cube.name}`, cube] as const)))
  let pixels = 0
  design.bones.forEach((bone, boneIndex) =>
    bone.cubes.forEach((cube, cubeIndex) => {
      const where = `${bone.name}.${cube.name}`
      const path = ["bones", boneIndex, "cubes", cubeIndex]
      if (cube.share) {
        const source = cubes.get(cube.share)
        if (!source) issue(`方块 ${where} 的 share 写的「${cube.share}」模型里没有：写成「骨骼名.方块名」，指向一个已有的方块。`, [...path, "share"])
        else if (source === cube) issue(`方块 ${where} 的 share 指向了它自己。`, [...path, "share"])
        else if (source.share) issue(`方块 ${where} 的 share 指向的 ${cube.share} 自己也是借别人的贴图（share ${source.share}）：直接指向 ${source.share}。`, [...path, "share"])
        else if (FACE_NAMES.some((face) => faceSize(source.size as never, face, texel).join() !== faceSize(cube.size as never, face, texel).join()))
          issue(`方块 ${where}（${cube.size.join("×")}）和它 share 的 ${cube.share}（${source.size.join("×")}）不一样大：只有一样大的方块才能共用一块贴图。`, [...path, "share"])
        if (cube.surface_details.length || cube.features?.length || cube.pixels) issue(`方块 ${where} 写了 share（穿 ${cube.share} 的贴图），它自己的 surface_details、features、pixels 不会画出来：去掉它们，或者去掉 share。`, [...path, "share"])
      }
      if (!cube.pixels) return
      if (!tier.face_pixels) issue(`方块 ${where} 写了 pixels（一个面一个像素地画），只有「最精细」「史诗」档可以；这个模型是「${tier.name}」档。用 surface_details，或者把 budget 写成 "finest" / "epic"（部件说明里写明为什么）。`, [...path, "pixels"])
      for (const face of FACE_NAMES) {
        const drawn = cube.pixels[face]
        if (!drawn) continue
        const [w, h] = faceSize(cube.size as never, face, texel)
        pixels += drawn.data.length
        if (drawn.data.length !== w * h) issue(`方块 ${where} 的 pixels.${face} 有 ${drawn.data.length} 个像素，这个面是 ${w}×${h}=${w * h} 个${texel > 1 ? `（texel_size ${texel}）` : ""}。`, [...path, "pixels", face])
        if (drawn.data.some((index) => index >= drawn.palette.length)) issue(`方块 ${where} 的 pixels.${face} 里有超出 palette（${drawn.palette.length} 种颜色）的编号。`, [...path, "pixels", face])
      }
    }),
  )
  if (pixels > FACE_PIXEL_LIMIT) issue(`整个模型的 pixels 一共 ${pixels} 个像素，最多 ${FACE_PIXEL_LIMIT} 个：只给要紧的面画像素，其余用 paint。`, ["bones"])
}

/** A creature's model: the shape, and the three motions the generated creature always plays. */
export const ModelDesignSchema = modelSchema(true)
/** The same shape with no motion asked for by name: what compiles and draws. Everything a model document checks about its own structure holds. */
export const ModelShapeSchema = modelSchema(false)

export type ModelDesign = z.infer<typeof ModelDesignSchema>

export const ModelingInputSchema = z.strictObject({
  step: z.enum(["model", "revise"]),
  content: z.string().trim().min(1).max(200000),
  revision: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  complexity: ModelComplexitySchema.optional(),
  images: z.array(ModelAnnotationImageSchema).max(1).optional(),
})
export type ModelingInput = z.infer<typeof ModelingInputSchema>

export const UsageSchema = z
  .strictObject({
    input_tokens: z.number().int().min(0),
    output_tokens: z.number().int().min(0),
    total_tokens: z.number().int().min(0),
  })
  .refine((usage) => usage.input_tokens + usage.output_tokens === usage.total_tokens)

export const ModelingResultSchema = z.strictObject({
  design: ModelDesignSchema,
  revision: ModelingInputSchema.shape.revision,
  usage: UsageSchema,
  provenance: z.strictObject({
    provider: z.literal("openai"),
    model: z.string().trim().min(1).max(120),
    reasoning_effort: z.literal("high"),
    response_id: z.string().min(1).max(200),
    task_id: z.string().min(1).max(100),
    user_id: z.string().min(1).max(100),
    created_at: z.string().datetime(),
    attempt: z.number().int().min(1).max(3),
  }),
})
export type ModelingResult = z.infer<typeof ModelingResultSchema>

// OpenAI arrays use homogeneous items, so encode XYZ tuples as length-three arrays.
export const ModelDesignJsonSchema = z.toJSONSchema(ModelDesignSchema, {
  target: "draft-2020-12",
  override: (context) => {
    if (context.zodSchema instanceof z.ZodTuple) {
      context.jsonSchema.items = context.jsonSchema.prefixItems?.[0]
      delete context.jsonSchema.prefixItems
      context.jsonSchema.minItems = 3
      context.jsonSchema.maxItems = 3
    }
  },
})

// Defaults and optional fields keep old saved projects readable, while strict model requests
// advertise every key as required (the optional ones accept null) to JSON-schema callers.
const requireEveryKey = (value: unknown): void => {
  if (!value || typeof value !== "object") return
  const object = value as Record<string, unknown>
  if (object.properties && typeof object.properties === "object" && Array.isArray(object.required))
    object.required = Object.keys(object.properties)
  Object.values(object).forEach(requireEveryKey)
}
requireEveryKey(ModelDesignJsonSchema)

import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import { budgetFaults, GEOMETRY_TIER_IDS, GEOMETRY_TIERS, TEXTURE_SIZES, type GeometryTier } from "@minemods/studio-ai/budget"
import { ANIMATION_LIMITS, ANIMATION_TRACKS, channelTracks } from "@minemods/studio-ai/animation"
import { blockbenchTrackWords, contractKeyWords } from "./blockbench-keys"
import { compileModel } from "./model"
import { decodeRgbaPng } from "./png-decode"
import { boneNamesFor, uniqueDesignName } from "./bone-names"
import { z } from "zod"

const Faces = ["north", "east", "south", "west", "up", "down"] as const
type Face = (typeof Faces)[number]

const Vector3Schema = z.tuple([z.number(), z.number(), z.number()])
const FaceSchema = z
  .object({
    uv: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    texture: z.union([z.number(), z.null()]).optional(),
    color: z.number().int().min(0).max(0xffffff).optional(),
  })
  .passthrough()
const ElementSchema = z
  .object({
    uuid: z.string().min(1),
    name: z.string().optional(),
    type: z.string().optional(),
    from: Vector3Schema,
    to: Vector3Schema,
    origin: Vector3Schema.optional(),
    rotation: Vector3Schema.optional(),
    faces: z.record(z.string(), FaceSchema),
  })
  .passthrough()
type Element = z.infer<typeof ElementSchema>
const OutlinerNodeSchema: z.ZodType<
  | { uuid: string; name?: string; origin?: [number, number, number]; rotation?: [number, number, number]; children?: Array<string | z.infer<typeof OutlinerNodeSchema>> }
> = z.lazy(() =>
  z
    .object({
      uuid: z.string().min(1),
      name: z.string().min(1).optional(),
      origin: Vector3Schema.optional(),
      rotation: Vector3Schema.optional(),
      children: z.array(z.union([z.string(), OutlinerNodeSchema])).optional(),
    })
    .passthrough(),
)
const KeyframeSchema = z
  .object({
    time: z.number().min(0),
    channel: z.string().optional(),
    data_points: z
      .array(
        z
          .object({ x: z.union([z.number(), z.string()]), y: z.union([z.number(), z.string()]), z: z.union([z.number(), z.string()]) })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()
const AnimationSchema = z
  .object({
    name: z.string().min(1),
    length: z.number().positive(),
    loop: z.union([z.boolean(), z.string()]),
    // Blockbench omits `keyframes` for untouched bones when the animate mode is active.
    // Keep the animator record so the archived .bbmodel remains authoritative.
    animators: z.record(z.string(), z.object({ keyframes: z.array(KeyframeSchema).optional() }).passthrough()).optional(),
  })
  .passthrough()
const BlockbenchProjectSchema = z
  .object({
    meta: z.object({ format_version: z.string().optional() }).passthrough().optional(),
    name: z.string().optional(),
    resolution: z.object({ width: z.number(), height: z.number() }).passthrough().optional(),
    elements: z.array(ElementSchema).optional(),
    outliner: z.array(z.union([z.string(), OutlinerNodeSchema])).optional(),
    groups: z.array(z.object({ uuid: z.string(), name: z.string(), origin: Vector3Schema, rotation: Vector3Schema }).passthrough()).optional(),
    animations: z.array(AnimationSchema).optional(),
    textures: z.array(z.unknown()).optional(),
  })
  .passthrough()

type BlockbenchKeyframe = z.infer<typeof KeyframeSchema>
type ParsedBlockbenchAnimator = NonNullable<z.infer<typeof AnimationSchema>["animators"]>[string]
type BlockbenchAnimator = Omit<ParsedBlockbenchAnimator, "keyframes"> & {
  keyframes: BlockbenchKeyframe[]
}
type BlockbenchAnimation = Omit<z.infer<typeof AnimationSchema>, "animators"> & {
  animators?: Record<string, BlockbenchAnimator>
}
export type BlockbenchProject = z.infer<typeof BlockbenchProjectSchema> & {
  animations?: BlockbenchAnimation[]
}

export type BlockbenchConversionResult = {
  design: ModelDesign
  warnings: string[]
}
type EditableOutlinerNode = { uuid: string; name: string; origin: [number, number, number]; rotation: [number, number, number]; children: Array<string | EditableOutlinerNode> }

/**
 * A .bbmodel Studio cannot take in, with the reason already worded for the person who picked the file: it names the
 * group or box at fault in the file's own words. `code` is the machine-readable cause for logs and tests.
 */
export class BlockbenchImportError extends Error {
  constructor(readonly code: string, words: string) {
    super(words)
    this.name = "BlockbenchImportError"
  }
}

/** Up to three names in 「」, then how many more, so a message about a hundred boxes stays one line. */
const listNames = (names: readonly string[]) => `${names.slice(0, 3).map((name) => `「${name}」`).join("、")}${names.length > 3 ? ` 等 ${names.length} 个` : ""}`

const AXIS_WORDS = ["宽", "高", "深"] as const
const CHINESE = /[\u4e00-\u9fff]/

/**
 * Says in plain words why a design made from the file was refused, naming the group and box in the file's own names.
 * The design's schema speaks in field paths; the person picked a file and knows only its groups and boxes.
 */
function designProblem(error: z.ZodError, groupNames: readonly string[], groupElements: readonly Element[][]) {
  const issue = error.issues[0]!
  const [root, boneIndex, part, cubeIndex, field, axis] = issue.path
  const group = typeof boneIndex === "number" ? groupNames[boneIndex] : undefined
  const element = typeof boneIndex === "number" && typeof cubeIndex === "number" ? groupElements[boneIndex]?.[cubeIndex] : undefined
  const box = element ? `骨骼「${group}」里的方块「${element.name ?? "未命名"}」` : undefined
  if (root === "bones" && part === "cubes" && element && field === "size" && typeof axis === "number") {
    const size = element.to[axis]! - element.from[axis]!
    return new BlockbenchImportError("MODEL_CUBE_SIZE", `${box}的${AXIS_WORDS[axis]}是 ${Number(size.toFixed(3))}，Studio 的方块大小只能是 1 到 256 之间的整数。请在 Blockbench 里把它改成整数大小，再导入。`)
  }
  if (root === "bones" && part === "cubes" && element && field === "origin")
    return new BlockbenchImportError("MODEL_CUBE_PLACE", `${box}的位置超出了 -256 到 256 的范围。请在 Blockbench 里把它挪回这个范围内，再导入。`)
  if (root === "bones" && group && (part === "pivot" || part === "rotation"))
    return new BlockbenchImportError("MODEL_BONE_RANGE", `骨骼「${group}」的${part === "pivot" ? "轴心位置超出了 -256 到 256 的范围" : "旋转角度超出了可用范围"}。请在 Blockbench 里改回范围内，再导入。`)
  if (issue.message === "Cube bounds must stay within 256 units") {
    const names = groupElements.flatMap((elements) => elements.filter((cube) => cube.to.some((value) => value > 256)).map((cube) => cube.name ?? "未命名"))
    return new BlockbenchImportError("MODEL_CUBE_BOUNDS", `${names.length ? `方块${listNames(names)}` : "有方块"}伸到了 256 格之外，模型最大只能是 256 格。请在 Blockbench 里把它缩小或挪回来，再导入。`)
  }
  // The design's own limits (how many bones, boxes and keys a model may have) are already worded for a person.
  if (CHINESE.test(issue.message)) return new BlockbenchImportError("MODEL_OVER_LIMIT", issue.message)
  return new BlockbenchImportError("MODEL_UNSUPPORTED", `这个模型里有 Studio 还做不了的地方${box ? `（${box}）` : group ? `（骨骼「${group}」）` : ""}。请在 Blockbench 里用方块和组重新搭一下，再导入。`)
}

const colorToHex = (color: number | undefined) => `#${(color ?? 0x808080).toString(16).padStart(6, "0")}`
type RecoveredFace = { color: string; details: Array<{ face: Face; x: number; y: number; width: number; height: number; color: string }>; pixels?: { palette: string[]; data: number[] }; flipped?: boolean }
const hexPixel = (pixels: Uint8Array, width: number, x: number, y: number) => {
  const offset = (y * width + x) * 4
  return { key: `${pixels[offset]!.toString(16).padStart(2, "0")}${pixels[offset + 1]!.toString(16).padStart(2, "0")}${pixels[offset + 2]!.toString(16).padStart(2, "0")}`, alpha: pixels[offset + 3]! }
}
function recoverFace(texture: ReturnType<typeof decodeRgbaPng>, element: Element, face: Face): RecoveredFace | undefined {
  const value = element.faces[face]
  const source = value?.uv
  // Earlier editor projects stored these two faces with a positive height.
  const uv = source && (face === "up" || face === "down") && source[3] < source[1] ? [source[2], source[3], source[0], source[1]] : source
  if (value?.texture !== 0 || !uv || uv.some((number) => !Number.isInteger(number)) || uv[2] === uv[0] || uv[3] <= uv[1] || (value as Record<string, unknown> | undefined)?.rotation) return undefined
  // 第 1 步: a mirrored face is written with its uv running right to left; it is read back as the texels it was painted with.
  const flipped = uv[2] < uv[0]
  const x = Math.min(uv[0], uv[2])
  const y = uv[1]
  const width = Math.abs(uv[2] - uv[0])
  const height = uv[3] - y
  const from = element.from
  const to = element.to
  const faceSize = face === "up" || face === "down" ? [to[0] - from[0], to[2] - from[2]] : face === "east" || face === "west" ? [to[2] - from[2], to[1] - from[1]] : [to[0] - from[0], to[1] - from[1]]
  if (width !== faceSize[0] || height !== faceSize[1]) return undefined
  if (x < 0 || y < 0 || x + width > texture.width || y + height > texture.height) return undefined
  const counts = new Map<string, number>()
  const values = Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, column) => {
    const pixel = hexPixel(texture.pixels, texture.width, x + (flipped ? width - 1 - column : column), y + row)
    if (pixel.alpha !== 255) return undefined
    counts.set(pixel.key, (counts.get(pixel.key) ?? 0) + 1)
    return pixel.key
  }))
  const color = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!color || values.some((row) => row.some((pixel) => pixel === undefined))) return undefined
  const details: RecoveredFace["details"] = []
  values.forEach((row, rowIndex) => {
    let column = 0
    while (column < width) {
      if (row[column] === color) {
        column += 1
        continue
      }
      const detailColor = row[column]!
      const start = column
      while (column < width && row[column] === detailColor) column += 1
      const previous = details.find((detail) => detail.color === `#${detailColor}` && detail.x === start && detail.width === column - start && detail.y + detail.height === rowIndex)
      if (previous && previous.color === `#${detailColor}` && previous.x === start && previous.width === column - start && previous.y + previous.height === rowIndex) previous.height += 1
      else details.push({ face, x: start, y: rowIndex, width: column - start, height: 1, color: `#${detailColor}` })
    }
  })
  // 第 1 步: every texel as well, for a tier whose faces may carry their own pixels (more than 64 rectangles is a painted face, not a few marks).
  const palette = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!)
  const pixels = palette.length <= 256 ? { palette: palette.map((key) => `#${key}`), data: values.flatMap((row) => row.map((pixel) => palette.indexOf(pixel!))) } : undefined
  if (details.length > 64 || details.reduce((area, detail) => area + detail.width * detail.height, 0) > 4096) return pixels ? { color: `#${color}`, details: [], pixels, flipped } : undefined
  return { color: `#${color}`, details, pixels, flipped }
}

function embeddedTexture(project: { textures?: unknown[]; resolution?: { width: number; height: number } }) {
  const source = z.record(z.string(), z.unknown()).safeParse(project.textures?.[0]).data?.source
  if (typeof source !== "string" || !source.startsWith("data:image/png;base64,")) return undefined
  try {
    const texture = decodeRgbaPng(Buffer.from(source.slice("data:image/png;base64,".length), "base64"))
    if (project.resolution && (project.resolution.width !== texture.width || project.resolution.height !== texture.height)) return undefined
    return texture
  } catch {
    return undefined
  }
}

const faceData = (color: string) =>
  Object.fromEntries(Faces.map((face) => [face, { uv: [0, 0, 1, 1], texture: null, color: Number.parseInt(color.slice(1), 16) }]))

export function designToBlockbench(input: unknown): BlockbenchProject {
  const design = ModelDesignSchema.parse(input)
  const compiled = compileModel(design, "minemods_model")
  const compiledBones = compiled.geometry["minecraft:geometry"][0].bones as Array<{ cubes: Array<{ uv: Record<Face, { uv: number[]; uv_size: number[] }> }> }>
  const boneUuids = new Map(design.bones.map((bone, index) => [bone.name, `minemods-bone-${index + 1}`]))
  const sharing = design.bones.flatMap((bone, boneIndex) => bone.cubes.flatMap((cube, cubeIndex) => (cube.share ? [[`minemods-cube-${boneIndex + 1}-${cubeIndex + 1}`, { share: cube.share, ...(cube.mirror ? { mirror: true } : {}) }] as const] : [])))
  const elements = design.bones.flatMap((bone, boneIndex) =>
    bone.cubes.map((cube, cubeIndex) => ({
      uuid: `minemods-cube-${boneIndex + 1}-${cubeIndex + 1}`,
      name: cube.name,
      type: "cube",
      from: cube.origin,
      to: [cube.origin[0] + cube.size[0], cube.origin[1] + cube.size[1], cube.origin[2] + cube.size[2]] as [number, number, number],
      // 第 1 步: a turned cube turns about its own pivot (Blockbench's element origin); an inflated one keeps its inflate.
      origin: (cube.rotation?.some((value) => value !== 0) ? (cube.pivot ?? cube.origin.map((value, axis) => value + cube.size[axis]! / 2)) : [0, 0, 0]) as [number, number, number],
      rotation: (cube.rotation?.some((value) => value !== 0) ? [...cube.rotation] : [0, 0, 0]) as [number, number, number],
      ...(cube.inflate ? { inflate: cube.inflate } : {}),
      autouv: 0,
      color: cube.faces.north ? Number.parseInt(cube.faces.north.slice(1), 16) : 0,
      faces: Object.fromEntries(
        Faces.map((face) => {
          const rect = compiledBones[boneIndex]!.cubes[cubeIndex]!.uv[face]
          const uv: [number,number,number,number] = [rect.uv[0]!, rect.uv[1]!, rect.uv[0]! + rect.uv_size[0]!, rect.uv[1]! + rect.uv_size[1]!]
          return [face, { uv: face === "up" || face === "down" ? [uv[2],uv[3],uv[0],uv[1]] as typeof uv : uv, texture: 0, color: Number.parseInt(cube.faces[face].slice(1), 16) }]
        }),
      ) as Record<Face, { uv: [number, number, number, number]; texture: number; color: number }>,
    })),
  )
  const outliner = design.bones.map((bone) => ({
    uuid: boneUuids.get(bone.name)!,
    name: bone.name,
    origin: bone.pivot,
    rotation: bone.rotation,
    children: bone.cubes.map((_, cubeIndex) => `minemods-cube-${design.bones.indexOf(bone) + 1}-${cubeIndex + 1}`),
  }))
  const nodes: EditableOutlinerNode[] = outliner.map((node) => ({ ...node, children: [...node.children] }))
  const nodeByName = new Map(nodes.map((node) => [node.name, node]))
  design.bones.forEach((bone) => {
    const node = nodeByName.get(bone.name)!
    if (bone.parent) nodeByName.get(bone.parent)!.children.push(node)
  })
  const animations = design.animations.map((animation) => ({
    name: animation.name,
    length: animation.length,
    loop: animation.loop,
    animators: Object.fromEntries(
      animation.channels.map((channel) => [
        boneUuids.get(channel.bone)!,
        {
          name: channel.bone,
          type: "bone",
          // Every track of the animation contract, with a key's interpolation in Blockbench's word when it is not a straight line.
          keyframes: ANIMATION_TRACKS.flatMap((track) => {
            const words = blockbenchTrackWords(channelTracks(channel)[track])
            return channelTracks(channel)[track].map((key, index) => ({
              time: key.time,
              channel: track,
              data_points: [{ x: key.value[0], y: key.value[1], z: key.value[2] }],
              ...words[index],
            }))
          }),
        },
      ]),
    ),
  }))
  return {
    meta: { format_version: "5.0", model_format: "free", box_uv: false },
    name: design.name,
    resolution: { width: design.texture_size, height: design.texture_size },
    elements,
    outliner: nodes.filter((node) => design.bones.find((bone) => bone.name === node.name)?.parent === null),
    animations,
    textures: [{ name: "minemods.png", id: "minemods-texture-1", path: "", source: `data:image/png;base64,${Buffer.from(compiled.png).toString("base64")}`, mode: "bitmap", visible: true, internal: true, uv_width: design.texture_size, uv_height: design.texture_size, width: design.texture_size, height: design.texture_size }],
    // The two settings of a design that no Blockbench field can hold are kept here, so the file comes back in as the model it was.
    minemods: {
      schema_version: 1,
      texture_policy: "compiled-face-color-atlas",
      source: "ModelDesign",
      png_override: true,
      ...(design.budget ? { budget: design.budget } : {}),
      ...(design.texel_size && design.texel_size > 1 ? { texel_size: design.texel_size } : {}),
      // 第 1 步: the model's shading and texture layout, and which cubes wear another's texture, which no Blockbench field holds.
      ...(design.shading ? { shading: design.shading } : {}),
      ...(design.atlas ? { atlas: design.atlas } : {}),
      ...(sharing.length ? { shares: Object.fromEntries(sharing) } : {}),
    },
  }
}

/** The groups of an outliner with how many boxes each holds directly: what a tier is counted on before the file is read in full. */
const countGroups = (nodes: Array<string | z.infer<typeof OutlinerNodeSchema>>): { name: string; cubes: unknown[] }[] =>
  nodes.flatMap((node) => (typeof node === "string" ? [] : [{ name: node.name ?? node.uuid, cubes: (node.children ?? []).filter((child) => typeof child === "string") }, ...countGroups(node.children ?? [])]))

const flattenGroups = (nodes: Array<string | z.infer<typeof OutlinerNodeSchema>>, parent: string | null, output: Array<{ uuid: string; name: string; parent: string | null; pivot: [number, number, number]; rotation: [number, number, number]; children: string[] }>, details: Map<string, { name: string; origin: [number, number, number]; rotation: [number, number, number] }>) => {
  nodes.forEach((node) => {
    if (typeof node === "string") return
    const detail = details.get(node.uuid)
    output.push({ uuid: node.uuid, name: node.name ?? detail?.name ?? node.uuid, parent, pivot: node.origin ?? detail?.origin ?? [0, 0, 0], rotation: node.rotation ?? detail?.rotation ?? [0, 0, 0], children: (node.children ?? []).filter((child): child is string => typeof child === "string") })
    flattenGroups((node.children ?? []).filter((child): child is z.infer<typeof OutlinerNodeSchema> => typeof child !== "string"), node.uuid, output, details)
  })
}

export function blockbenchToDesignResult(input: unknown): BlockbenchConversionResult {
  const parsedProject = BlockbenchProjectSchema.safeParse(input)
  if (!parsedProject.success) throw new BlockbenchImportError("BBMODEL_UNREADABLE", "这个文件读不出来：它不是 Blockbench 的 .bbmodel 模型，或者保存时损坏了。请在 Blockbench 里重新保存一次再导入。")
  const project = parsedProject.data
  const elements = project.elements ?? []
  // What Studio itself wrote about the design beyond Blockbench's fields (see designToBlockbench); anything else in the block is not read.
  const own = z
    .object({
      budget: z.enum(GEOMETRY_TIER_IDS).optional(),
      texel_size: z.union([z.literal(2), z.literal(4)]).optional(),
      shading: z.enum(["flat", "rich"]).optional(),
      atlas: z.enum(["rows", "packed"]).optional(),
      shares: z.record(z.string(), z.object({ share: z.string(), mirror: z.boolean().optional() })).optional(),
    })
    .safeParse((project as { minemods?: unknown }).minemods)
  const textureSize = project.resolution?.width ?? project.resolution?.height ?? 64
  // 第 1 步: a file Studio did not write names no tier; it is held to the lowest tier its boxes, bones and texture fit (a hand-made boss of
  // 130 boxes on a 512 texture is not refused for being past the standard tier), never above what the file has.
  const tier: GeometryTier =
    own.success && own.data.budget
      ? own.data.budget
      : (GEOMETRY_TIER_IDS.find((id) => {
          const counted = { budget: id, texture_size: TEXTURE_SIZES.find((size) => size >= textureSize) ?? TEXTURE_SIZES[TEXTURE_SIZES.length - 1], bones: (project.outliner ? countGroups(project.outliner) : (project.groups ?? []).map((group) => ({ name: group.name, cubes: [] as unknown[] }))), animations: [] }
          return budgetFaults({ ...counted, bones: counted.bones.length ? counted.bones : [{ name: "", cubes: [] }] }).length === 0 && elements.length <= GEOMETRY_TIERS[id].cubes
        }) ?? "standard")
  const paintedRich = own.success && own.data.shading === "rich"
  const texture = project.textures?.length === 1 && (!project.resolution || project.resolution.width === project.resolution.height)
    ? embeddedTexture(project)
    : undefined
  let textureRecoveryMisses = 0
  const groups = project.outliner ? [] : (project.groups ?? []).map((group) => ({ uuid: group.uuid, name: group.name, parent: null, pivot: group.origin, rotation: group.rotation, children: [] as string[] }))
  if (project.outliner) flattenGroups(project.outliner, null, groups, new Map((project.groups ?? []).map((group) => [group.uuid, group])))
  const elementByUuid = new Map(elements.map((element) => [element.uuid, element]))
  const rootGroups = groups.filter((group) => group.parent === null)
  if (groups.length === 0) throw new BlockbenchImportError("MODEL_HIERARCHY_REQUIRED", "这个模型里还没有骨骼（Blockbench 里叫「组」）。先在 Blockbench 里建一个组，把方块放进去，再导入。")
  if (rootGroups.length !== 1)
    throw new BlockbenchImportError(
      "MODEL_HIERARCHY_ROOT",
      `这个模型最外层有 ${rootGroups.length} 个组（${listNames(rootGroups.map((group) => group.name))}）。Studio 需要所有部件都挂在同一个最外层的组下面：在 Blockbench 里新建一个组，把它们拖进去，再导入。`,
    )
  const placed = new Set(groups.flatMap((group) => group.children))
  const loose = elements.filter((element) => !placed.has(element.uuid))
  if (loose.length)
    throw new BlockbenchImportError(
      "MODEL_HIERARCHY_INVALID",
      `有 ${loose.length} 个方块不在任何组里（${listNames(loose.map((element) => element.name ?? "未命名"))}）。Studio 里每个方块都要属于一根骨骼：在 Blockbench 里把它们拖进某个组，再导入。`,
    )
  // Blockbench keys everything by uuid and allows repeated names, so a bone's name here is made from the group's name by
  // the one rule `editable-model.ts` also uses to find the group again; only bones compete for a name (see bone-names.ts).
  const groupElements = groups.map((group) => group.children.map((child) => elementByUuid.get(child)).filter((element): element is Element => element !== undefined))
  const designNames = boneNamesFor(groups.map((group) => group.name))
  const bones = groups.map((group, groupIndex) => ({
    name: designNames[groupIndex]!,
    parent: null as string | null,
    pivot: group.pivot,
    rotation: group.rotation,
    // The boxes in the order the group lists them: the saved-model check pairs a bone's cubes with the group's children by
    // position, and Blockbench keeps the elements array in creation order, which is not the order the outliner shows after a drag.
    cubes: (() => {
      const cubeNames = new Set<string>()
      return groupElements[groupIndex]!
        .map((element) => {
        const recoveredFaces = Object.fromEntries(Faces.map((face) => [face, texture && recoverFace(texture, element, face)])) as Record<Face, RecoveredFace | undefined>
        if (texture) textureRecoveryMisses += Faces.filter((face) => !recoveredFaces[face]).length
        const recoveredDetails = Faces.flatMap((face) => recoveredFaces[face]?.details ?? [])
        const detailsRepresentable = recoveredDetails.length <= 64 && recoveredDetails.reduce((area, detail) => area + detail.width * detail.height, 0) <= 4096
        if (texture && !detailsRepresentable && !GEOMETRY_TIERS[tier].face_pixels) textureRecoveryMisses += 1
        const size = [element.to[0] - element.from[0], element.to[1] - element.from[1], element.to[2] - element.from[2]] as [number, number, number]
        // 第 1 步: the element's own turn about its origin, its inflate, faces written mirrored, and (a tier with face pixels) a face too busy for rectangles kept pixel for pixel.
        const turned = element.rotation?.some((value) => value !== 0)
        const inflate = typeof element.inflate === "number" && element.inflate !== 0 ? Math.max(-2, Math.min(4, element.inflate)) : null
        const shared = own.success ? own.data.shares?.[element.uuid] : undefined
        const mirrored = shared ? shared.mirror === true : Faces.every((face) => recoveredFaces[face]?.flipped)
        // Kept pixel for pixel when rectangles cannot hold a face, and always for a model Studio painted rich (its shading is in the texels; painted again it would be shaded twice).
        const facePixels = !shared && GEOMETRY_TIERS[tier].face_pixels && (!detailsRepresentable || paintedRich)
          ? Object.fromEntries(Faces.filter((face) => recoveredFaces[face]?.pixels && recoveredFaces[face]!.pixels!.palette.length > 1).map((face) => [face, recoveredFaces[face]!.pixels!]))
          : null
        return {
        name: uniqueDesignName(element.name ?? "cube", cubeNames, "cube"),
        origin: element.from,
        size,
        faces: Object.fromEntries(Faces.map((face) => [face, recoveredFaces[face]?.color ?? colorToHex(element.faces[face]?.color)])) as ModelDesign["bones"][number]["cubes"][number]["faces"],
        surface_details: shared || facePixels ? [] : detailsRepresentable ? recoveredDetails : [],
        ...(turned ? { rotation: element.rotation!, pivot: element.origin ?? (element.from.map((value, axis) => value + size[axis]! / 2) as [number, number, number]) } : {}),
        ...(inflate ? { inflate } : {}),
        ...(mirrored ? { mirror: true } : {}),
        ...(shared ? { share: shared.share } : {}),
        ...(facePixels && Object.keys(facePixels).length ? { pixels: facePixels } : {}),
      }
      })
    })(),
  }))
  const boneNames = new Map(groups.map((group, index) => [group.uuid, bones[index]!.name]))
  bones.forEach((bone, index) => {
    const group = groups[index]!
    bone.parent = group.parent === null ? null : boneNames.get(group.parent) ?? null
  })
  const requiredAnimationNames = ["idle", "walk", "hurt"] as const
  const animationFor = (name: string, animation: z.infer<typeof AnimationSchema> | undefined) => {
    return {
      name,
      length: animation?.length ?? 1,
      loop: animation ? animation.loop === true || animation.loop === "loop" : name !== "hurt",
      channels: groups.flatMap((group) => {
        const animator = animation?.animators?.[group.uuid]
        const number = (value: number | string | undefined) => typeof value === "number" ? value : Number(value ?? 0)
        const read = (track: (typeof ANIMATION_TRACKS)[number]) => {
          const keyframes = (animator?.keyframes ?? []).filter((keyframe) => (keyframe.channel ?? "rotation") === track)
          // 第 2 步: a bezier key keeps its handles and an easing GeckoLib's plugin wrote comes along (`blockbench-keys.ts`); any other word is a straight line, as before.
          const order = keyframes.map((keyframe, index) => ({ keyframe, index })).sort((a, b) => a.keyframe.time - b.keyframe.time || a.index - b.index)
          const sortedWords = contractKeyWords(order.map((entry) => entry.keyframe as Record<string, unknown>))
          const words = new Map(order.map((entry, at) => [entry.index, sortedWords[at] ?? {}]))
          return keyframes.map((keyframe, index) => {
            const point = keyframe.data_points?.[0]
            return { time: keyframe.time, value: [number(point?.x), number(point?.y), number(point?.z)] as [number, number, number], ...words.get(index) }
          })
        }
        const keyframes = read("rotation").map(({ value, ...key }) => ({ ...key, rotation: value }))
        // A position or scale track is taken into the design when it fits the contract's limits; one that does not stays in the .bbmodel snapshot only, as before.
        const fits = (keys: ReturnType<typeof read>, low: number, high: number) => keys.length > 0 && keys.length <= ANIMATION_LIMITS.keys && keys.every((key, index) => key.value.every((part) => Number.isFinite(part) && part >= low && part <= high) && key.time <= (animation?.length ?? 1) && (index === 0 || key.time > keys[index - 1]!.time))
        const position = fits(read("position"), -ANIMATION_LIMITS.position, ANIMATION_LIMITS.position) ? read("position").map(({ value, ...key }) => ({ ...key, position: value })) : null
        const scale = fits(read("scale"), 0, ANIMATION_LIMITS.scale) ? read("scale").map(({ value, ...key }) => ({ ...key, scale: value })) : null
        return [{ bone: boneNames.get(group.uuid)!, keyframes: keyframes.length || position || scale ? keyframes : [{ time: 0, rotation: [0, 0, 0] as [number, number, number] }], ...(position ? { position } : {}), ...(scale ? { scale } : {}) }]
      }),
    }
  }
  const requiredAnimations = requiredAnimationNames.map((name) => animationFor(name, project.animations?.find((candidate) => candidate.name.toLowerCase() === name)))
  const usedAnimationNames = new Set(requiredAnimations.map((animation) => animation.name))
  const extraAnimations = (project.animations ?? [])
    .filter((animation) => !requiredAnimationNames.includes(animation.name.toLowerCase() as (typeof requiredAnimationNames)[number]))
    .map((animation) => animationFor(uniqueDesignName(animation.name, usedAnimationNames), animation))
  const animations = [...requiredAnimations, ...extraAnimations]
  const parsedDesign = ModelDesignSchema.safeParse({
    name: project.name ?? "Blockbench Model",
    texture_size: TEXTURE_SIZES.find((size) => size >= textureSize) ?? TEXTURE_SIZES[TEXTURE_SIZES.length - 1],
    ...(tier !== "standard" ? { budget: tier } : {}),
    ...(own.success && own.data.texel_size ? { texel_size: own.data.texel_size } : {}),
    // A texture read back already holds the shading; only a file without one paints it again.
    ...(own.success && own.data.shading && !texture ? { shading: own.data.shading } : {}),
    ...(own.success && own.data.atlas ? { atlas: own.data.atlas } : {}),
    bones,
    animations,
  })
  if (!parsedDesign.success) throw designProblem(parsedDesign.error, groups.map((group) => group.name), groupElements)
  const design = parsedDesign.data
  const missingAnimatorKeyframes = (project.animations ?? []).reduce((count, animation) => count + Object.values(animation.animators ?? {}).filter((animator) => animator.keyframes === undefined).length, 0)
  return {
    design,
    warnings: [
      ...(project.textures?.length ? ["Blockbench textures are retained in the .bbmodel snapshot; ModelDesign stores face colors and recoverable surface rectangles, while unsupported texture edits require the compiled PNG override."] : []),
      ...(textureRecoveryMisses ? [`${textureRecoveryMisses} face texture region(s) could not be represented as integer surface rectangles; the native Blockbench snapshot remains authoritative.`] : []),
      ...(missingAnimatorKeyframes ? [`${missingAnimatorKeyframes} Blockbench animation animator(s) omit keyframes; the native animator records remain in the .bbmodel snapshot and ModelDesign uses default channels for them.`] : []),
    ],
  }
}

export function blockbenchToDesign(input: unknown): ModelDesign {
  return blockbenchToDesignResult(input).design
}

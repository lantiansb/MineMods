import { unzipSync } from "fflate"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { compileModel } from "./model"
import { modelBounds } from "./model-bounds"
import { encodePng } from "./png"
import { decodeRgbaPng } from "./png-decode"

type Geometry = {
  format_version: string
  "minecraft:geometry": Array<{
    description: Record<string, unknown>
    bones: Array<{
      name: string
      parent?: string
      pivot: number[]
      rotation?: number[]
      cubes: Array<{
        origin: number[]
        size: number[]
        uv: Record<Face, { uv: number[]; uv_size: number[]; rotation?: number; visible?: boolean }>
        rotation?: number[]
        pivot?: number[]
        scale?: number[]
      }>
    }>
  }>
}
type Animation = ReturnType<typeof compileModel>["animation"]
export type ImportedModelPreview = {
  format: string
  model: ModelDesign | null
  preview: {
    faceUvSpace?: "editor"
    geometry: Geometry
    textureDataUrl: string
    animation?: Animation
    /** How the game draws the skin: cut out (the default for creatures) or blended see-through. */
    look?: { blend: boolean; opacity: number }
  } | null
  blockbench: Record<string, unknown> | null
  textures: string[]
  diagnostics: string[]
}

type Face = "north" | "east" | "south" | "west" | "up" | "down"
type Cube = {
  name: string
  origin: [number, number, number]
  size: [number, number, number]
  uv: Record<
    Face,
    { uv: [number, number]; uv_size: [number, number]; rotation?: number; visible?: boolean; material?: string }
  >
  rotation?: [number, number, number]
  pivot?: [number, number, number]
  scale?: [number, number, number]
  inflate?: number
}
type Bone = {
  name: string
  parent: string | null
  pivot: [number, number, number]
  rotation: [number, number, number]
  cubes: Cube[]
}
type Scene = {
  bones: Bone[]
  width: number
  height: number
  name: string
  textureReference?: string
  textureReferences?: string[]
  textureValues?: Record<string, unknown>
  bedrock?: boolean
  templateOnly?: boolean
  embeddedTexture?: Uint8Array
  format: string
  diagnostics: string[]
  unsupported?: string
}
const faces: Face[] = ["north", "east", "south", "west", "up", "down"]
const transparent = "#ffffff"
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const vector = (value: unknown): value is number[] => Array.isArray(value) && value.length === 3 && value.every(finite)
const rect = (value: unknown): value is number[] => Array.isArray(value) && value.length === 4 && value.every(finite)
const pair = (value: unknown): value is number[] => Array.isArray(value) && value.length === 2 && value.every(finite)
const safeName = (name: string, fallback: string) =>
  `${name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[^a-zA-Z]+/, "") || fallback}`.slice(0, 48)
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const tuple = (value: number[]): [number, number, number] => [value[0]!, value[1]!, value[2]!]
const bedrockPoint = (point: number[]): [number,number,number] => [-point[0]! || 0,point[1]!,point[2]!]
const bedrockAngles = (angles: number[]): [number,number,number] => [-angles[0]! || 0,-angles[1]! || 0,angles[2]!]
const faceBounds = (face: Face, rect: number[], bedrock: boolean): [number,number,number,number] =>
  bedrock && (face === "up" || face === "down") ? [rect[2]!,rect[3]!,rect[0]!,rect[1]!] : [rect[0]!,rect[1]!,rect[2]!,rect[3]!]
const uvFaces = (u: number, v: number, x: number, y: number, z: number, mirror = false): Cube["uv"] => {
  const faces: Cube["uv"] = {
    north: { uv: [u + z, v + z], uv_size: [x, y] },
    east: { uv: [u, v + z], uv_size: [z, y] },
    south: { uv: [u + z + x + z, v + z], uv_size: [x, y] },
    west: { uv: [u + z + x, v + z], uv_size: [z, y] },
    up: { uv: [u + z, v], uv_size: [x, z] },
    down: { uv: [u + z + x, v], uv_size: [x, z] },
  }
  if (!mirror) return faces
  const flip = (rect: Cube["uv"][Face]) => ({
    uv: [rect.uv[0] + rect.uv_size[0], rect.uv[1]] as [number, number],
    uv_size: [-rect.uv_size[0], rect.uv_size[1]] as [number, number],
  })
  return {
    north: flip(faces.north),
    east: flip(faces.west),
    south: flip(faces.south),
    west: flip(faces.east),
    up: flip(faces.up),
    down: flip(faces.down),
  }
}

function parseTabula(value: Record<string, unknown>): Scene {
  const width = value.textureWidth,
    height = value.textureHeight
  if (
    !finite(width) ||
    !finite(height) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    !Array.isArray(value.cubes)
  )
    throw new Error("TABULA_HEADER_INVALID")
  const bones: Bone[] = [],
    seen = new Set<string>()
  const visit = (parts: unknown[], parent: string | null, parentPivot: [number, number, number], depth: number) => {
    if (depth > 64) throw new Error("MODEL_NODE_LIMIT")
    parts.forEach((raw, index) => {
      if (bones.length >= 512) throw new Error("MODEL_NODE_LIMIT")
      if (
        !object(raw) ||
        !vector(raw.position) ||
        !vector(raw.offset) ||
        !vector(raw.dimensions) ||
        !vector(raw.rotation) ||
        !Array.isArray(raw.txOffset) ||
        raw.txOffset.length !== 2 ||
        !raw.txOffset.every(finite)
      )
        throw new Error("TABULA_NODE_INVALID")
      const name = safeName(typeof raw.name === "string" ? raw.name : `part_${index}`, `part_${index}`)
      const uniqueName = (suffix: number): string => {
        const candidate = suffix === 0 ? name : safeName(`${name}_${suffix}`, "part")
        return seen.has(candidate) ? uniqueName(suffix + 1) : candidate
      }
      const unique = uniqueName(0)
      seen.add(unique)
      const rawSize = raw.dimensions as number[]
      if (rawSize.some((size) => size < 0 || size > 256)) throw new Error("MODEL_DIMENSIONS_INVALID")
      const [x, y, z] = rawSize.map((size) => Math.max(size, 0.01))
      const position = raw.position as number[],
        offset = raw.offset as number[],
        rotation = raw.rotation as number[]
      const sourcePivot = tuple(position.map((component, axis) => component + parentPivot[axis]!))
      const pivot = tuple([sourcePivot[0], -sourcePivot[1], sourcePivot[2]])
      const origin = tuple([
        sourcePivot[0] + offset[0]!,
        -(sourcePivot[1] + offset[1]! + y),
        sourcePivot[2] + offset[2]!,
      ])
      const tex = raw.txOffset as number[]
      const bone: Bone = {
        name: unique,
        parent,
        pivot,
        rotation: tuple(rotation),
        cubes: [
          {
            name: unique,
            origin,
            size: [x, y, z],
            pivot,
            rotation: [0, 0, 0],
            uv: uvFaces(tex[0]!, tex[1]!, rawSize[0]!, rawSize[1]!, rawSize[2]!, raw.txMirror === true),
          },
        ],
      }
      bones.push(bone)
      if (Array.isArray(raw.children)) visit(raw.children, unique, sourcePivot, depth + 1)
      else if (raw.children !== undefined) throw new Error("TABULA_NODE_INVALID")
    })
  }
  visit(value.cubes, null, [0, 0, 0], 0)
  if (!bones.length) throw new Error("MODEL_EMPTY")
  return {
    bones,
    width,
    height,
    name: typeof value.modelName === "string" ? value.modelName : "Tabula model",
    format: "tabula",
    diagnostics: bones.some((bone) => bone.cubes.some((cube) => cube.size.some((size) => size === 0.01)))
      ? ["零厚度Tabula cuboid使用0.01单位厚度预览。"]
      : [],
  }
}

function parseGeometry(value: Record<string, unknown>, format: "gecko" | "vanilla"): Scene {
  const json = object(value.geometry) ? value.geometry : value
  const geometries = json["minecraft:geometry"]
  const doc = Array.isArray(geometries) && object(geometries[0]) ? geometries[0] : json
  const description = object(doc.description) ? doc.description : {}
  const width = description.texture_width ?? 16,
    height = description.texture_height ?? 16
  if (
    !finite(width) ||
    !finite(height) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    !Array.isArray(doc.bones)
  )
    throw new Error("GEOMETRY_HEADER_INVALID")
  if (doc.bones.length > 512) throw new Error("MODEL_NODE_LIMIT")
  const bones: Bone[] = doc.bones.map((raw: unknown, index: number) => {
    if (
      !object(raw) ||
      typeof raw.name !== "string" ||
      (raw.pivot !== undefined && !vector(raw.pivot)) ||
      (raw.rotation !== undefined && !vector(raw.rotation)) ||
      !Array.isArray(raw.cubes ?? [])
    )
      throw new Error("GEOMETRY_BONE_INVALID")
    const name = safeName(raw.name, `bone_${index}`)
    const cubes = (Array.isArray(raw.cubes) ? raw.cubes : []).map((cube: unknown, cubeIndex: number): Cube => {
      if (!object(cube) || !vector(cube.origin) || !vector(cube.size) || cube.size.some((v) => v <= 0 || v > 256))
        throw new Error("GEOMETRY_CUBE_INVALID")
      const base = Array.isArray(cube.uv) && cube.uv.length >= 2 && cube.uv.slice(0, 2).every(finite) ? cube.uv : [0, 0]
      const [x,y,z] = tuple(cube.size)
      const box = uvFaces(base[0] as number, base[1] as number, x, y, z, (cube.mirror ?? raw.mirror) === true)
      // Box UV has the underside folded back across the atlas seam.
      box.down.uv[1] += z
      box.down.uv_size[1] = -z
      const uv: Cube["uv"] = Object.fromEntries(
        faces.map((face) => {
          const rect = object(cube.uv) ? cube.uv[face] : undefined
          if (!object(cube.uv)) return [face, box[face]]
          if (!object(rect) || !pair(rect.uv)) return [face, { uv: [0,0], uv_size: [0,0], visible: false }]
          const size = pair(rect.uv_size) ? rect.uv_size : [Math.abs(box[face].uv_size[0]), Math.abs(box[face].uv_size[1])]
          return [face, { uv: [rect.uv[0], rect.uv[1]], uv_size: [size[0], size[1]], ...(finite(rect.uv_rotation) ? { rotation: rect.uv_rotation } : {}) }]
        }),
      ) as Cube["uv"]
      return {
        name: safeName(typeof cube.name === "string" ? cube.name : `${name}_${cubeIndex}`, "cube"),
        origin: tuple(cube.origin),
        size: tuple(cube.size),
        uv,
        ...(finite(cube.inflate ?? raw.inflate) ? {inflate: Number(cube.inflate ?? raw.inflate)} : {}),
        ...(vector(cube.pivot) ? { pivot: tuple(cube.pivot) } : {}),
        ...(vector(cube.rotation) ? { rotation: tuple(cube.rotation) } : {}),
      }
    })
    return {
      name,
      parent: typeof raw.parent === "string" ? safeName(raw.parent, "root") : null,
      pivot: vector(raw.pivot) ? tuple(raw.pivot) : [0, 0, 0],
      rotation: vector(raw.rotation) ? tuple(raw.rotation) : [0, 0, 0],
      cubes,
    }
  })
  if (!bones.length) throw new Error("MODEL_EMPTY")
  const names = new Set(bones.map((bone) => bone.name))
  if (names.size !== bones.length) throw new Error("MODEL_BONE_NAME_COLLISION")
  const byName = new Map(bones.map((bone) => [bone.name, bone]))
  bones.forEach((bone) => {
    let parent = bone.parent,
      depth = 0,
      visited = new Set([bone.name])
    while (parent) {
      if (!names.has(parent) || visited.has(parent) || depth++ > 64) throw new Error("MODEL_HIERARCHY_INVALID")
      visited.add(parent)
      parent = byName.get(parent)!.parent
    }
  })
  const usesPolyMesh = doc.bones.some((bone: unknown) => object(bone) && object(bone.poly_mesh))
  const multipleGeometry = Array.isArray(geometries) && geometries.length > 1
  const notes = [
    ...(usesPolyMesh ? ["检测到非cuboid mesh；此适配器只转换cube。"] : []),
    ...(multipleGeometry ? ["文件包含多个geometry；当前预览只转换第一个。"] : []),
  ]
  return {
    bones,
    width,
    height,
    name:
      typeof description.identifier === "string"
        ? description.identifier
        : typeof value.name === "string"
          ? value.name
          : "Imported model",
    format,
    diagnostics: notes,
    bedrock: true,
    unsupported: usesPolyMesh ? "包含不支持的非cuboid mesh。" : undefined,
  }
}

function parseBlockbench(value: Record<string, unknown>): Scene {
  if (!Array.isArray(value.elements) || value.elements.length > 512) throw new Error("BBMODEL_ELEMENTS_INVALID")
  const resolution = object(value.resolution) ? value.resolution : {}
  const width = resolution.width ?? 16,
    height = resolution.height ?? 16
  if (![width, height].every((n) => finite(n) && Number.isInteger(n) && n > 0 && n <= 4096))
    throw new Error("BBMODEL_RESOLUTION_INVALID")
  const elements = value.elements.map((entry, index) => {
    if (!object(entry)) throw new Error("BBMODEL_CUBE_INVALID")
    return [typeof entry.uuid === "string" ? entry.uuid : `cube_${index}`, entry] as const
  })
  const groups = new Map((Array.isArray(value.groups) ? value.groups : []).filter(object).map(g => [g.uuid,g]))
  const bedrock = object(value.meta) && value.meta.model_format === "bedrock"
  const gamePivot = (p: number[]): [number,number,number] => bedrock ? bedrockPoint(p) : tuple(p)
  const gameRotation = (r: number[]): [number,number,number] => bedrock ? bedrockAngles(r) : tuple(r)
  const ids = new Map<string, Record<string, unknown>>(elements)
  if (ids.size !== elements.length) throw new Error("BBMODEL_ELEMENT_ID_COLLISION")
  const bones: Bone[] = [],
    visited = new Set<string>()
  const add = (
    name: string,
    parent: string | null,
    children: unknown[],
    pivot: [number, number, number],
    rotation: [number, number, number],
    depth = 0,
  ) => {
    if (bones.length >= 512 || depth > 64) throw new Error("MODEL_NODE_LIMIT")
    const bone = { name: safeName(name, "root"), parent, pivot:gamePivot(pivot), rotation:gameRotation(rotation), cubes: [] as Cube[] }
    bones.push(bone)
    children.forEach((id) => {
      if (typeof id !== "string") {
        if (object(id) && Array.isArray(id.children)) {
          const group = groups.get(id.uuid) ?? id
          add(
            String(group.name ?? "group"),
            bone.name,
            id.children,
            vector(group.origin) ? tuple(group.origin) : [0, 0, 0],
            vector(group.rotation) ? tuple(group.rotation) : [0, 0, 0],
            depth + 1,
          )
        }
        return
      }
      const e = ids.get(id)
      if (!e) throw new Error("BBMODEL_OUTLINER_INVALID")
      visited.add(id)
      if (!vector(e.from) || !vector(e.to)) throw new Error("BBMODEL_CUBE_INVALID")
      const from = e.from,
        to = e.to
      if (to.some((v, i) => v <= from[i]! || v - from[i]! > 256)) throw new Error("BBMODEL_CUBE_INVALID")
      const size = tuple(to.map((v, i) => v - from[i]!))
      const faceUv: Cube["uv"] = Object.fromEntries(
        faces.map((face) => {
          const sourceFaces = object(e.faces) ? e.faces : {}
          const f = sourceFaces[face]
          const uv = object(f) && rect(f.uv) ? faceBounds(face,f.uv,bedrock) : null
          return [
            face,
            object(f) && uv
              ? { uv: [uv[0],uv[1]], uv_size: [uv[2]-uv[0],uv[3]-uv[1]], ...(finite(f.rotation) ? {rotation:f.rotation} : {}) }
              : uvFaces(0, 0, ...size)[face],
          ]
        }),
      ) as Cube["uv"]
      bone.cubes.push({
        name: safeName(typeof e.name === "string" ? e.name : id, "cube"),
        origin: bedrock ? [-to[0]!,from[1]!,from[2]!] : tuple(from),
        size,
        uv: faceUv,
        ...(finite(e.inflate) ? {inflate:e.inflate} : {}),
        ...(vector(e.rotation)
          ? { rotation: gameRotation(e.rotation), pivot: vector(e.origin) ? gamePivot(e.origin) : [0, 0, 0] }
          : {}),
      })
    })
  }
  if (Array.isArray(value.outliner))
    value.outliner.forEach((node) => {
      if (typeof node === "string") add("root", null, [node], [0, 0, 0], [0, 0, 0])
      else if (object(node)) {
        const group = groups.get(node.uuid) ?? node
        add(
          typeof group.name === "string" ? group.name : "root",
          null,
          Array.isArray(node.children) ? node.children : [],
          vector(group.origin) ? tuple(group.origin) : [0, 0, 0],
          vector(group.rotation) ? tuple(group.rotation) : [0, 0, 0],
        )
      }
    })
  if (new Set(bones.map((bone) => bone.name)).size !== bones.length) throw new Error("MODEL_BONE_NAME_COLLISION")
  if (!bones.length) add("root", null, [...ids.keys()], [0, 0, 0], [0, 0, 0])
  if (!bones.some((bone) => bone.cubes.length)) throw new Error("MODEL_EMPTY")
  const textureEntries = Array.isArray(value.textures) ? value.textures : []
  const multiTexture =
    textureEntries.length > 1 ||
    elements.some(([, element]) => {
      const elementFaces = object(element.faces) ? element.faces : {}
      return faces.some(
        (face) =>
          object(elementFaces[face]) &&
          typeof elementFaces[face].texture === "number" &&
          elementFaces[face].texture > 0,
      )
    })
  const faceRotation = elements.some(([, element]) => {
    const elementFaces = object(element.faces) ? element.faces : {}
    return faces.some(
      (face) =>
        object(elementFaces[face]) &&
        typeof elementFaces[face].rotation === "number" &&
        ![0, 90, 180, 270].includes(elementFaces[face].rotation),
    )
  })
  const embedded =
    object(textureEntries[0]) && typeof textureEntries[0].source === "string" ? textureEntries[0].source : undefined
  const embeddedTexture = embedded?.startsWith("data:image/png;base64,")
    ? Uint8Array.from(Buffer.from(embedded.slice("data:image/png;base64,".length), "base64"))
    : undefined
  return {
    bones,
    width: width as number,
    height: height as number,
    name: typeof value.name === "string" ? value.name : "Blockbench model",
    embeddedTexture,
    format: "bbmodel",
    bedrock,
    diagnostics: [
      ...(visited.size < ids.size ? ["部分未挂接到Outliner的cuboid已跳过。"] : []),
      ...(multiTexture ? ["Blockbench多贴图模型暂不支持单纹理预览。"] : []),
      ...(faceRotation ? ["面的贴图旋转只支持 0、90、180 和 270 度。"] : []),
    ],
    unsupported: multiTexture ? "包含多个贴图材质。" : faceRotation ? "包含非直角的贴图旋转。" : undefined,
  }
}

function readPngSize(bytes: Uint8Array) {
  if (bytes.length < 24 || Buffer.from(bytes.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a")
    throw new Error("TEXTURE_PNG_INVALID")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16),
    height = view.getUint32(20)
  if (!width || !height || width * height > 16_777_216) throw new Error("TEXTURE_SIZE_INVALID")
  return [width, height] as const
}

export async function loadImportedModel(input: {
  entryPath: string
  paths: string[]
  readFile: (path: string) => Promise<Uint8Array>
  texturePath?: string
  resolveRuntimeModel?: (input: {
    entryPath: string
    json: Record<string, unknown>
  }) => Promise<{ json: Record<string, unknown>; diagnostics?: string[] } | null>
}): Promise<ImportedModelPreview> {
  const diagnostics: string[] = []
  if (input.paths.length > 20_000) throw new Error("MODEL_PATH_LIMIT")
  const entryPath = input.entryPath.replaceAll("\\", "/")
  const extension = entryPath.split(".").pop()?.toLowerCase()
  if (extension === "java" || extension === "class")
    return {
      format: "java-source",
      model: null,
      preview: null,
      blockbench: null,
      textures: [],
      diagnostics: ["Java构造模型需要执行模组代码才能还原几何；适配器不会执行Java类。"],
    }
  const source = await input.readFile(entryPath)
  if (source.length > 64 * 1024 * 1024) throw new Error("MODEL_FILE_TOO_LARGE")
  let scene: Scene, textureBytes: Uint8Array | undefined
  if (extension === "tbl") {
    let modelCount = 0,
      textureCount = 0,
      zipEntryCount = 0
    const entries = unzipSync(source, {
      filter: (entry) => {
        if (++zipEntryCount > 4096) throw new Error("TABULA_ENTRY_COUNT_LIMIT")
        if (entry.name.length > 1024) throw new Error("TABULA_ENTRY_PATH_LIMIT")
        if (entry.name === "model.json") {
          if (++modelCount > 1) throw new Error("TABULA_DUPLICATE_ENTRY")
          if (entry.originalSize > 4 * 1024 * 1024) throw new Error("TABULA_MODEL_TOO_LARGE")
          return true
        }
        if (entry.name === "texture.png") {
          if (++textureCount > 1) throw new Error("TABULA_DUPLICATE_ENTRY")
          if (entry.originalSize > 32 * 1024 * 1024) throw new Error("TABULA_TEXTURE_TOO_LARGE")
          return true
        }
        return false
      },
    })
    const json = entries["model.json"]
    if (!json) throw new Error("TABULA_JSON_MISSING")
    scene = parseTabula(JSON.parse(new TextDecoder().decode(json)))
    textureBytes = entries["texture.png"]
    if (!textureBytes) diagnostics.push("Tabula文件没有内置texture.png。")
  } else {
    const text = new TextDecoder().decode(source)
    let json = JSON.parse(text)
    if (!object(json)) throw new Error("MODEL_JSON_INVALID")
    if (Array.isArray(json.elements) && (Array.isArray(json.outliner) || object(json.meta)))
      scene = parseBlockbench(json)
    else if (
      Array.isArray(json["minecraft:geometry"]) ||
      (object(json.geometry) && Array.isArray(json.geometry["minecraft:geometry"]))
    )
      scene = parseGeometry(json, "gecko")
    else if (
      json.parent ||
      json.textures ||
      Array.isArray(json.elements) ||
      "loader" in json ||
      ["gui_light", "ambientocclusion", "display", "overrides", "credit"].some((key) => key in json)
    ) {
      if (json.loader === "forge:composite") {
        const children = object(json.children) ? json.children : {}
        const order = Array.isArray(json.item_render_order)
          ? json.item_render_order.filter((key): key is string => typeof key === "string" && object(children[key]))
          : Object.keys(children)
        const elements = await Promise.all(
          order.map(async (key) => {
            const child = children[key]
            if (!object(child)) return []
            const inherited = await resolveVanillaInheritance(
              entryPath,
              {
                ...child,
                ...(typeof child.parent === "string" || typeof json.parent !== "string" ? {} : { parent: json.parent }),
                textures: {
                  ...(object(json.textures) ? json.textures : {}),
                  ...(object(child.textures) ? child.textures : {}),
                },
              },
              input.readFile,
            )
            const textures = object(inherited.textures) ? inherited.textures : {}
            return (Array.isArray(inherited.elements) ? inherited.elements : []).map((element) => {
              if (!object(element) || !object(element.faces)) return element
              return {
                ...element,
                faces: Object.fromEntries(
                  Object.entries(element.faces).map(([face, value]) => [
                    face,
                    object(value) && typeof value.texture === "string"
                      ? { ...value, texture: resolveTextureValue(value.texture, textures) ?? value.texture }
                      : value,
                  ]),
                ),
              }
            })
          }),
        )
        json = { ...json, parent: undefined, loader: undefined, children: undefined, elements: elements.flat() }
        diagnostics.push(`Forge composite按${order.length}个子模型静态合并；状态相关渲染次序保留为诊断。`)
      }
      if (json.loader === "forge:separate_transforms" && object(json.base)) {
        const base = json.base
        json = {
          ...json,
          ...base,
          textures: {
            ...(object(json.textures) ? json.textures : {}),
            ...(object(base.textures) ? base.textures : {}),
          },
          loader: undefined,
          base: undefined,
          perspectives: undefined,
        }
        diagnostics.push("Forge separate_transforms使用base几何；perspectives视角专用模型未展开。")
      }
      if (json.loader === "forge:item_layers") {
        json = { ...json, loader: undefined }
        diagnostics.push("Forge item_layers使用静态layer模型；光照与render_types状态未执行。")
      }
      if (
        typeof json.loader === "string" &&
        json.loader !== "forge:composite" &&
        json.loader !== "forge:separate_transforms" &&
        json.loader !== "forge:item_layers"
      ) {
        if (Array.isArray(json.elements)) {
          const loader = json.loader
          json = { ...json, loader: undefined }
          diagnostics.push(`${loader}存在静态elements，按这些elements预览；loader条件和动态状态未执行。`)
        } else {
          const textureReferences = Object.values(object(json.textures) ? json.textures : {}).filter(
            (value): value is string => typeof value === "string" && !value.startsWith("#"),
          )
          if (typeof json.texture === "string") textureReferences.push(json.texture)
          return {
            format: "vanilla",
            model: null,
            preview: null,
            blockbench: null,
            textures: [
              ...new Set(
                textureReferences.flatMap((reference) =>
                  textureCandidatesByReference(input.paths, entryPath, reference),
                ),
              ),
            ],
            diagnostics: [
              `Minecraft自定义模型加载器${json.loader}未提供静态elements；已保留可解析的纹理引用，需运行时加载器才能还原几何。`,
            ],
          }
        }
      }
      let inherited = await resolveVanillaInheritance(entryPath, json, input.readFile)
      const builtin = inherited.__builtinEntity === true
      if (builtin && !input.resolveRuntimeModel)
        return {
          format: "vanilla",
          model: null,
          preview: null,
          blockbench: null,
          textures: [],
          diagnostics: ["此模型使用builtin/entity运行时渲染标记；它不是磁盘JSON父模型，需提供运行时模型解析器。"],
        }
      if (builtin && input.resolveRuntimeModel) {
        delete inherited.__builtinEntity
        delete inherited.parent
        const runtime = await input.resolveRuntimeModel({ entryPath, json: inherited })
        if (!runtime)
          return {
            format: "vanilla",
            model: null,
            preview: null,
            blockbench: null,
            textures: [],
            diagnostics: ["此模型使用builtin/entity运行时渲染标记，未提供可用的运行时模型解析结果。"],
          }
        inherited = runtime.json
        diagnostics.push(...(runtime.diagnostics ?? []))
      }
      if (inherited.__builtinGenerated === true) {
        delete inherited.__builtinGenerated
        if (!Array.isArray(inherited.elements)) {
          const layers = Object.keys(object(inherited.textures) ? inherited.textures : {})
            .filter((key) => /^layer\d+$/.test(key))
            .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
          inherited.elements = (layers.length ? layers : ["layer0"]).flatMap((layer, index) => [
            {
              from: [0, 0, 8 + index * 0.01],
              to: [16, 16, 8 + index * 0.01],
              faces: {
                north: { uv: [0, 0, 16, 16], texture: `#${layer}` },
                south: { uv: [0, 0, 16, 16], texture: `#${layer}` },
              },
            },
          ])
        }
        diagnostics.push("builtin/generated按薄平面近似预览layer图层；未重建纹理alpha轮廓厚度。")
      }
      if (inherited.loader === "forge:item_layers")
        diagnostics.push("Forge item_layers使用静态layer模型；光照与render_types状态未执行。")
      delete inherited.parent
      scene = await parseVanilla(entryPath, inherited, input.readFile)
    } else scene = await parseVanilla(entryPath, json, input.readFile)
  }
  if (!textureBytes && scene.embeddedTexture) textureBytes = scene.embeddedTexture
  const textureReferences = scene.textureReferences ?? (scene.textureReference ? [scene.textureReference] : [])
  const referenceMatches = textureReferences.map(
    (reference) => [reference, textureCandidatesByReference(input.paths, entryPath, reference)[0]] as const,
  )
  const referencedCandidates = [...new Set(referenceMatches.flatMap(([, path]) => (path ? [path] : [])))]
  const directoryCandidates = scene.format === "tabula" ? tabulaTextureCandidates(input.paths, entryPath) : []
  const stemCandidates =
    referencedCandidates.length || directoryCandidates.length || scene.templateOnly
      ? []
      : sameStemTextureCandidates(input.paths, entryPath)
  const textureChoices = [...new Set([...referencedCandidates, ...directoryCandidates, ...stemCandidates])]
  let texturePath = input.texturePath ?? textureChoices[0]
  let resolvedScene = scene
  if (input.texturePath)
    textureBytes = await readTextureFrame(
      input.texturePath,
      await input.readFile(input.texturePath),
      input.paths,
      input.readFile,
      diagnostics,
    )
  else if (referenceMatches.filter(([, path]) => path).length > 1) {
    const images = await Promise.all(
      referenceMatches
        .filter(([, path]) => path)
        .map(async ([reference, path]) => ({
          reference,
          path: path!,
          bytes: await readTextureFrame(path!, await input.readFile(path!), input.paths, input.readFile, diagnostics),
        })),
    )
    const atlas = createTextureAtlas(scene, images)
    if (atlas) {
      resolvedScene = atlas.scene
      textureBytes = atlas.bytes
      texturePath = images[0]?.path
    }
  } else if (textureChoices[0]) {
    textureBytes = await readTextureFrame(
      textureChoices[0],
      await input.readFile(textureChoices[0]),
      input.paths,
      input.readFile,
      diagnostics,
    )
    if (scene.format === "tabula" && !scene.textureReference)
      diagnostics.push(`没有纹理引用，已按Tabula模型目录默认绑定${textureChoices[0]}；可从相关贴图候选切换。`)
  }
  scene = resolvedScene
  if (input.texturePath && !textureChoices.includes(input.texturePath)) textureChoices.unshift(input.texturePath)
  if (scene.unsupported)
    return {
      format: scene.format,
      model: null,
      preview: null,
      blockbench: null,
      textures: texturePath ? [texturePath] : [],
      diagnostics: [...scene.diagnostics, ...diagnostics, scene.unsupported],
    }
  if (scene.templateOnly && !textureBytes && !texturePath)
    return {
      format: scene.format,
      model: null,
      preview: null,
      blockbench: null,
      textures: [],
      diagnostics: [...scene.diagnostics, ...diagnostics, "这是未绑定独立纹理的模型模板；其几何可由子模型继承。"],
    }
  if (!textureBytes && !texturePath && !scene.diagnostics.some((diagnostic) => diagnostic.includes("纹理")))
    diagnostics.push("没有找到模型贴图，当前使用白色预览占位图。")
  const totalCubes = scene.bones.reduce((count, bone) => count + bone.cubes.length, 0)
  if (!scene.bones.length || !totalCubes) throw new Error("MODEL_EMPTY")
  if (scene.bones.length > 512 || totalCubes > 2048) throw new Error("MODEL_NODE_LIMIT")
  const physicalTextureSize = textureBytes ? readPngSize(textureBytes) : ([scene.width, scene.height] as const)
  if (textureBytes && physicalTextureSize[0] / scene.width !== physicalTextureSize[1] / scene.height)
    diagnostics.push(
      `贴图物理尺寸${physicalTextureSize[0]}×${physicalTextureSize[1]}与模型逻辑UV比例不同，已保留原PNG和逻辑UV。`,
    )
  const colors = Object.fromEntries(faces.map((face) => [face, transparent])) as Record<Face, string>
  const model: ModelDesign = {
    name: String(scene.name).slice(0, 80),
    texture_size: 256,
    bones: scene.bones.map((bone) => ({
      ...bone,
      cubes: bone.cubes.map((cube) => ({
        ...cube,
        size: cube.size.map((value) => Math.max(1, Math.round(value))) as [number, number, number],
        faces: colors,
        surface_details: [],
      })),
    })),
    animations: [],
  }
  const bounds = modelBounds(model)
  const geometry: Geometry = {
    format_version: "1.12.0",
    "minecraft:geometry": [
      {
        description: {
          identifier: "geometry.imported_model",
          texture_width: scene.width,
          texture_height: scene.height,
          visible_bounds_width: Math.max(8, bounds.width * 2),
          visible_bounds_height: Math.max(8, (bounds.max[1]! - bounds.min[1]!) / 8),
          visible_bounds_offset: [0, (bounds.max[1]! + bounds.min[1]!) / 32, 0],
        },
        bones: scene.bones.map((bone) => ({
          name: bone.name,
          ...(bone.parent ? { parent: bone.parent } : {}),
          pivot: bone.pivot,
          rotation: bone.rotation,
          cubes: bone.cubes.map((cube) => ({
            origin: cube.origin,
            size: cube.size,
            uv: cube.uv,
            ...(cube.inflate ? {inflate:cube.inflate} : {}),
            ...(cube.rotation ? { rotation: cube.rotation } : {}),
            ...(cube.pivot ? { pivot: cube.pivot } : {}),
            ...(cube.scale ? { scale: cube.scale } : {}),
          })),
        })),
      },
    ],
  }
  const textureDataUrl = `data:image/png;base64,${Buffer.from(textureBytes ?? encodePng(Uint8Array.from([255, 255, 255, 255]), 1, 1)).toString("base64")}`
  if (!textureBytes) diagnostics.push("没有解析到PNG纹理，预览将使用占位白色。")
  const textureSource = textureBytes
    ? `data:image/png;base64,${Buffer.from(textureBytes).toString("base64")}`
    : undefined
  const editorBones = scene.bedrock ? scene.bones.map((bone) => ({
    ...bone,
    pivot: bedrockPoint(bone.pivot),
    rotation: bedrockAngles(bone.rotation),
    cubes: bone.cubes.map((cube) => ({
      ...cube,
      origin: bedrockPoint([cube.origin[0] + cube.size[0], cube.origin[1], cube.origin[2]]),
      ...(cube.pivot ? { pivot: bedrockPoint(cube.pivot) } : {}),
      ...(cube.rotation ? { rotation: bedrockAngles(cube.rotation) } : {}),
    })),
  })) : scene.bones
  const blockbench = {
    meta: { format_version: "5.0", model_format: scene.bedrock ? "bedrock" : "free", box_uv: false },
    name: scene.name,
    resolution: { width: scene.width, height: scene.height },
    elements: editorBones.flatMap((bone) =>
      bone.cubes.map((cube, index) => ({
        uuid: `${bone.name}_${index}`,
        name: cube.name,
        type: "cube",
        from: cube.origin,
        to: cube.origin.map((v, axis) => v + cube.size[axis]!),
        origin: cube.pivot ?? bone.pivot,
        rotation: cube.rotation ?? [0, 0, 0],
        ...(cube.inflate ? {inflate:cube.inflate} : {}),
        faces: Object.fromEntries(
          faces.map((face) => {
            const rect = cube.uv[face]
            return [
              face,
              { uv: faceBounds(face,[...rect.uv,rect.uv[0]+rect.uv_size[0],rect.uv[1]+rect.uv_size[1]],!!scene.bedrock),
                ...(rect.rotation ? {rotation:rect.rotation} : {}), texture: 0 },
            ]
          }),
        ),
      })),
    ),
    outliner: blockbenchOutliner(editorBones),
    textures: textureSource
      ? [
          {
            name: texturePath?.split(/[\\/]/).pop() ?? "texture.png",
            path: null,
            source: textureSource,
            uuid: "imported_texture",
            width: physicalTextureSize[0],
            height: physicalTextureSize[1],
          },
        ]
      : [],
    animations: [],
  }
  return {
    format: scene.format,
    model,
    preview: { geometry, textureDataUrl, ...(scene.bedrock ? {} : { faceUvSpace: "editor" as const }) },
    blockbench,
    textures: textureChoices,
    diagnostics: [...scene.diagnostics, ...diagnostics],
  }
}

function textureCandidatesByReference(paths: string[], entryPath: string, reference: string) {
  const normalized = reference.replace(/^#/, "")
  const namespace = normalized.includes(":") ? normalized.slice(0, normalized.indexOf(":")) : "minecraft"
  const resource = normalized.includes(":") ? normalized.slice(normalized.indexOf(":") + 1) : normalized
  return paths.filter((path) =>
    path.replaceAll("\\", "/").replace(/^\.\//, "").endsWith(`assets/${namespace}/textures/${resource}.png`),
  )
}

function resolveTextureValue(
  value: string,
  textures: Record<string, unknown>,
  seen = new Set<string>(),
): string | undefined {
  const key = value.replace(/^#/, "")
  if (!value.startsWith("#")) return value.includes(":") ? value : `minecraft:${value}`
  if (seen.has(key)) return undefined
  seen.add(key)
  const next = textures[key]
  return typeof next === "string" ? resolveTextureValue(next, textures, seen) : undefined
}

function tabulaTextureCandidates(paths: string[], entryPath: string) {
  const location = entryPath.match(/assets\/([^/]+)\/models\/tabula\/([^/]+)\//)
  if (!location) return []
  const prefix = `assets/${location[1]}/textures/models/${location[2]}/`.toLowerCase()
  const excluded = /(?:^|[_/.-])(eyes|sleeping|skeleton|emissive)(?:[_/.-]|$)/i
  return paths
    .filter((path) => {
      const normalized = path.replaceAll("\\", "/")
      const basename = normalized.slice(normalized.lastIndexOf("/") + 1)
      return (
        normalized.toLowerCase().includes(prefix) && basename.toLowerCase().endsWith(".png") && !excluded.test(basename)
      )
    })
    .sort(
      (left, right) => Number(!/_1\.png$/i.test(left)) - Number(!/_1\.png$/i.test(right)) || left.localeCompare(right),
    )
    .slice(0, 512)
}

function sameStemTextureCandidates(paths: string[], entryPath: string) {
  const stem = entryPath
    .slice(entryPath.lastIndexOf("/") + 1)
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
  const namespace = entryPath.match(/assets\/([^/]+)\//)?.[1]
  if (!namespace) return []
  return paths.filter((path) => {
    const normalized = path.replaceAll("\\", "/").toLowerCase()
    return (
      normalized.endsWith(".png") &&
      normalized.includes(`assets/${namespace.toLowerCase()}/textures/`) &&
      normalized.slice(normalized.lastIndexOf("/") + 1).startsWith(stem)
    )
  })
}

function blockbenchOutliner(bones: Bone[]) {
  const children = new Map<string | null, Bone[]>()
  bones.forEach((bone) => children.set(bone.parent, [...(children.get(bone.parent) ?? []), bone]))
  const toNode = (bone: Bone): Record<string, unknown> => ({
    uuid: bone.name,
    name: bone.name,
    origin: bone.pivot,
    rotation: bone.rotation,
    children: [
      ...bone.cubes.map((_, index) => `${bone.name}_${index}`),
      ...(children.get(bone.name) ?? []).map(toNode),
    ],
  })
  return (children.get(null) ?? []).map(toNode)
}

async function parseVanilla(
  entryPath: string,
  json: Record<string, unknown>,
  readFile: (path: string) => Promise<Uint8Array>,
): Promise<Scene> {
  const flattened = await resolveVanillaInheritance(entryPath, json, readFile)
  delete flattened.parent
  delete flattened.__builtinEntity
  const diagnostics: string[] = []
  const load = async (model: Record<string, unknown>, path: string, seen: Set<string>): Promise<Scene> => {
    if (seen.has(path) || seen.size > 32) throw new Error("VANILLA_PARENT_CYCLE")
    seen.add(path)
    if (typeof model.parent === "string" && model.parent.endsWith("builtin/entity"))
      return {
        bones: [],
        width: 16,
        height: 16,
        name: path,
        format: "vanilla",
        diagnostics: ["此模型的builtin/entity父项需运行时解析。"],
        unsupported: "builtin/entity运行时模型解析器不可用。",
      }
    const textures: Record<string, unknown> = {
      ...(object(model.textures) ? model.textures : {}),
    }
    const resolveTexture = (key: string, seenTextures = new Set<string>()): string | undefined => {
      if (seenTextures.has(key)) return undefined
      seenTextures.add(key)
      const value = textures[key]
      return typeof value === "string" && value.startsWith("#")
        ? resolveTexture(value.slice(1), seenTextures)
        : typeof value === "string"
          ? value
          : undefined
    }
    const textureReference =
      resolveTexture("all") ??
      resolveTexture("side") ??
      resolveTexture("layer0") ??
      resolveTexture("end") ??
      resolveTexture("north")
    const elements: unknown[] = Array.isArray(model.elements) ? model.elements : []
    if (elements.length > 256) throw new Error("MODEL_NODE_LIMIT")
    let unsupported: string | undefined
    const cubes = elements.map((rawElement, index): Cube => {
      if (!object(rawElement) || !vector(rawElement.from) || !vector(rawElement.to))
        throw new Error("VANILLA_CUBE_INVALID")
      const rawFrom = rawElement.from,
        rawTo = rawElement.to
      if (rawFrom.some((v, i) => Math.abs(rawTo[i]! - v) > 256)) throw new Error("VANILLA_CUBE_INVALID")
      const from = rawFrom.map((v, i) => Math.min(v, rawTo[i]!))
      const to = rawFrom.map((v, i) => Math.max(v, rawTo[i]!))
      if (rawFrom.some((v, i) => v > rawTo[i]!))
        diagnostics.push("Vanilla元素的from/to坐标反向，已规范化几何范围并保留UV镜像。")
      const size = tuple(to.map((v, i) => v - from[i]!))
      const sourceFaces = object(rawElement.faces) ? rawElement.faces : {}
      const faceUvs = faces.map((face) => {
        const f = sourceFaces[face]
        const defaultUv =
          face === "north"
            ? [16 - to[0]!, 16 - to[1]!, 16 - from[0]!, 16 - from[1]!]
            : face === "south"
              ? [from[0]!, 16 - to[1]!, to[0]!, 16 - from[1]!]
              : face === "west"
                ? [from[2]!, 16 - to[1]!, to[2]!, 16 - from[1]!]
                : face === "east"
                  ? [16 - to[2]!, 16 - to[1]!, 16 - from[2]!, 16 - from[1]!]
                  : face === "up"
                    ? [from[0]!, from[2]!, to[0]!, to[2]!]
                    : [from[0]!, 16 - to[2]!, to[0]!, 16 - from[2]!]
        const rawUv = object(f) && rect(f.uv) ? (f.uv as number[]) : undefined
        return [
          face,
          !object(f)
            ? { uv: [0, 0], uv_size: [0, 0], visible: false }
            : rawUv
              ? {
                  uv: [rawUv![0]!, rawUv![1]!],
                  uv_size: [rawUv![2]! - rawUv![0]!, rawUv![3]! - rawUv![1]!],
                  ...(finite(f.rotation) ? { rotation: f.rotation } : {}),
                  ...(typeof f.texture === "string"
                    ? { material: f.texture.startsWith("#") ? resolveTexture(f.texture.slice(1)) : f.texture }
                    : {}),
                }
              : {
                  uv: [defaultUv[0]!, defaultUv[1]!],
                  uv_size: [defaultUv[2]! - defaultUv[0]!, defaultUv[3]! - defaultUv[1]!],
                  ...(finite(f.rotation) ? { rotation: f.rotation } : {}),
                  ...(typeof f.texture === "string"
                    ? { material: f.texture.startsWith("#") ? resolveTexture(f.texture.slice(1)) : f.texture }
                    : {}),
                },
        ]
      })
      const axis =
        object(rawElement.rotation) && typeof rawElement.rotation.axis === "string"
          ? rawElement.rotation.axis
          : undefined
      const angle = object(rawElement.rotation) && finite(rawElement.rotation.angle) ? rawElement.rotation.angle : 0
      const rotation =
        axis === "x" ? [angle, 0, 0] : axis === "y" ? [0, angle, 0] : axis === "z" ? [0, 0, angle] : undefined
      const rescale =
        object(rawElement.rotation) && rawElement.rotation.rescale === true
          ? 1 / Math.cos((Math.abs(angle) * Math.PI) / 180)
          : 1
      const scale =
        axis === "x"
          ? [1, rescale, rescale]
          : axis === "y"
            ? [rescale, 1, rescale]
            : axis === "z"
              ? [rescale, rescale, 1]
              : undefined
      const rawRotation = object(rawElement.rotation) ? rawElement.rotation : {}
      const pivot = vector(rawRotation.origin)
        ? tuple(rawRotation.origin)
        : tuple(from.map((v, i) => v + (to[i]! - v) / 2))
      return {
        name: `cube_${index}`,
        origin: tuple(from),
        size,
        uv: Object.fromEntries(faceUvs) as Cube["uv"],
        ...(rotation ? { rotation: tuple(rotation), pivot } : {}),
        ...(scale ? { scale: tuple(scale) } : {}),
      }
    })
    if (cubes.some((cube) => cube.size.some((value) => value === 0)))
      diagnostics.push("包含零厚度平面，已按原始几何预览。")
    if (!cubes.length)
      return {
        bones: [],
        width: 16,
        height: 16,
        name: path,
        format: "vanilla",
        diagnostics: [...diagnostics, "此模型只包含元数据，没有可预览的元素。"],
        unsupported: "此模型只包含元数据，没有可预览的元素。",
      }
    const materialReferences = [
      ...new Set(
        cubes.flatMap((cube) => faces.flatMap((face) => (cube.uv[face].material ? [cube.uv[face].material!] : []))),
      ),
    ].filter((value) => value !== "particle")
    if (cubes.some((cube) => faces.some((face) => cube.uv[face].material === undefined))) {
      if (!materialReferences.length && !textureReference)
        diagnostics.push("元素没有绑定独立纹理；当前JSON仅提供可继承的几何模板。")
    }
    const hasTint = elements.some(
      (element) =>
        object(element) &&
        object(element.faces) &&
        Object.values(element.faces).some((face) => object(face) && finite(face.tintindex) && face.tintindex >= 0),
    )
    if (hasTint && !diagnostics.includes("检测到tintindex动态染色；预览未应用生物群系或方块颜色。"))
      diagnostics.push("检测到tintindex动态染色；预览未应用生物群系或方块颜色。")
    if (
      elements.some((element) => object(element) && object(element.condition)) &&
      !diagnostics.includes("元素包含条件状态；预览同时显示所有静态条件分支。")
    )
      diagnostics.push("元素包含条件状态；预览同时显示所有静态条件分支。")
    const multiTexture = materialReferences.length > 1
    if (multiTexture) diagnostics.push("Vanilla模型引用多个材质纹理，已合成为单张预览atlas。")
    if (unsupported) diagnostics.push(unsupported)
    return {
      bones: [{ name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes }],
      width: 16,
      height: 16,
      name: path,
      textureReference,
      textureReferences: [...new Set([...(textureReference ? [textureReference] : []), ...materialReferences])],
      textureValues: textures,
      templateOnly: !textureReference && !materialReferences.length,
      format: "vanilla",
      diagnostics,
      unsupported,
    }
  }
  return load(flattened, entryPath, new Set())
}

function resolveParentPath(modelPath: string, parent: string) {
  const namespace = parent.slice(0, parent.indexOf(":"))
  const resource = parent.slice(parent.indexOf(":") + 1)
  const normalizedPath = modelPath.replaceAll("\\", "/")
  const marker = normalizedPath.indexOf("assets/")
  const base = marker === -1 ? "" : normalizedPath.slice(0, marker)
  // Some mods name a parent under `util/` without the `block/` folder it lives in.
  if (resource.startsWith("util/"))
    return `${base}assets/${namespace}/models/block/${resource}.json`
  return `${base}assets/${namespace}/models/${resource}.json`
}

async function resolveVanillaInheritance(
  entryPath: string,
  model: Record<string, unknown>,
  readFile: (path: string) => Promise<Uint8Array>,
  seen = new Set<string>(),
): Promise<Record<string, unknown>> {
  const parent =
    typeof model.parent === "string"
      ? model.parent.includes(":")
        ? model.parent
        : `minecraft:${model.parent}`
      : undefined
  if (!parent || parent.endsWith(":builtin/entity") || parent.endsWith(":builtin/generated"))
    return parent?.endsWith(":builtin/entity")
      ? { ...model, __builtinEntity: true }
      : parent?.endsWith(":builtin/generated")
        ? { ...model, __builtinGenerated: true }
        : model
  const parentPath = resolveParentPath(entryPath, parent)
  if (seen.has(parentPath) || seen.size > 32) throw new Error("VANILLA_PARENT_CYCLE")
  seen.add(parentPath)
  const parentJson: unknown = JSON.parse(new TextDecoder().decode(await readFile(parentPath)))
  if (!object(parentJson)) throw new Error("VANILLA_PARENT_INVALID")
  const inherited = await resolveVanillaInheritance(parentPath, parentJson, readFile, seen)
  return {
    ...inherited,
    ...model,
    textures: {
      ...(object(inherited.textures) ? inherited.textures : {}),
      ...(object(model.textures) ? model.textures : {}),
    },
    ...(Array.isArray(model.elements)
      ? { elements: model.elements }
      : Array.isArray(inherited.elements)
        ? { elements: inherited.elements }
        : {}),
  }
}

function createTextureAtlas(scene: Scene, images: { reference: string; path: string; bytes: Uint8Array }[]) {
  const decoded = images.map((image) => ({ ...image, png: decodeRgbaPng(image.bytes) }))
  if (decoded.length < 2) return undefined
  const first = decoded[0]!.png
  const width = decoded.reduce((sum, image) => sum + image.png.width, 0)
  const height = Math.max(...decoded.map((image) => image.png.height))
  if (width > 4096 || height > 4096 || width * height > 16_777_216) throw new Error("TEXTURE_ATLAS_SIZE_INVALID")
  const pixels = new Uint8Array(width * height * 4)
  let offset = 0
  const positions = new Map<string, number>()
  decoded.forEach((image) => {
    positions.set(image.reference, offset)
    for (let row = 0; row < image.png.height; row++)
      pixels.set(
        image.png.pixels.subarray(row * image.png.width * 4, (row + 1) * image.png.width * 4),
        (row * width + offset) * 4,
      )
    offset += image.png.width
  })
  const atlasScene: Scene = {
    ...scene,
    width,
    height,
    bones: scene.bones.map((bone) => ({
      ...bone,
      cubes: bone.cubes.map((cube) => ({
        ...cube,
        uv: Object.fromEntries(
          faces.map((face) => {
            const rect = cube.uv[face]
            const ref = rect.material ?? scene.textureReference ?? images[0]!.reference
            const source = decoded.find((image) => image.reference === ref) ?? decoded[0]!
            const sourceX = positions.get(source.reference) ?? 0
            const scaleX = source.png.width / scene.width
            const scaleY = source.png.height / scene.height
            return [
              face,
              {
                ...rect,
                uv: [rect.uv[0] * scaleX + sourceX, rect.uv[1] * scaleY],
                uv_size: [rect.uv_size[0] * scaleX, rect.uv_size[1] * scaleY],
                material: undefined,
              },
            ]
          }),
        ) as Cube["uv"],
      })),
    })),
  }
  return { scene: atlasScene, bytes: encodePng(pixels, width, height) }
}

async function readTextureFrame(
  path: string,
  bytes: Uint8Array,
  paths: string[],
  readFile: (path: string) => Promise<Uint8Array>,
  diagnostics: string[],
) {
  const metadataPath = `${path}.mcmeta`
  if (!paths.includes(metadataPath)) return bytes
  const metadata = JSON.parse(new TextDecoder().decode(await readFile(metadataPath)))
  if (!object(metadata) || !object(metadata.animation)) return bytes
  const png = decodeRgbaPng(bytes)
  const animation = metadata.animation
  const frameWidth = finite(animation.width) ? animation.width : png.width
  const frameHeight = finite(animation.height) ? animation.height : frameWidth
  if (frameWidth < 1 || frameHeight < 1 || png.width % frameWidth || png.height % frameHeight)
    throw new Error("TEXTURE_ANIMATION_INVALID")
  const frames = Array.isArray(animation.frames) ? animation.frames : []
  const firstFrame = frames[0]
  const frameIndex = finite(firstFrame)
    ? firstFrame
    : object(firstFrame) && finite(firstFrame.index)
      ? firstFrame.index
      : 0
  const columns = png.width / frameWidth
  const x = (frameIndex % columns) * frameWidth
  const y = Math.floor(frameIndex / columns) * frameHeight
  if (y + frameHeight > png.height) throw new Error("TEXTURE_ANIMATION_FRAME_INVALID")
  const pixels = new Uint8Array(frameWidth * frameHeight * 4)
  for (let row = 0; row < frameHeight; row++)
    pixels.set(
      png.pixels.subarray(((y + row) * png.width + x) * 4, ((y + row) * png.width + x + frameWidth) * 4),
      row * frameWidth * 4,
    )
  diagnostics.push(`${path}是动画纹理；预览静态显示第${frameIndex}帧。`)
  return encodePng(pixels, frameWidth, frameHeight)
}

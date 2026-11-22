type JsonObject = Record<string, unknown>

type ImportedRuntimeModelInput = {
  entryPath: string
  json: JsonObject
}

type ImportedRuntimeModelResult = {
  json: JsonObject
  diagnostics?: string[]
} | null

type ResolverOptions = {
  paths: string[]
  readFile: (path: string) => Promise<Uint8Array>
}

const decoder = new TextDecoder()
const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const skullLayerKey: Record<string, string> = {
  zombie: "zombie_head",
  skeleton: "skeleton_skull",
  wither_skeleton: "wither_skeleton_skull",
  creeper: "creeper_head",
}

export function createImportedRuntimeResolver(options: ResolverOptions) {
  return async ({ entryPath }: ImportedRuntimeModelInput): Promise<ImportedRuntimeModelResult> => {
    const classPaths = options.paths.filter((path) => path.endsWith(".class"))
    const rendererPath = classPaths.find(
      (path) => /renderer/i.test(path) && /(?:skull.*candle|candle.*skull)/i.test(path),
    )
    if (!rendererPath) return null
    const entry = entryPath.replaceAll("\\", "/")
    const stem = entry.slice(entry.lastIndexOf("/") + 1).replace(/\.json$/i, "")
    const skullKind = resolveSkullKind(stem)
    if (!skullKind) return null
    const skullTexture = skullTexturePath(skullKind)
    if (!skullTexture) return null
    const skullModelPath = classPaths.find((path) =>
      /net\/minecraft\/client\/model\/SkullModel\.class$/i.test(path.replaceAll("\\", "/")),
    )
    const modelLayersPath = classPaths.find((path) =>
      /net\/minecraft\/client\/model\/geom\/ModelLayers\.class$/i.test(path.replaceAll("\\", "/")),
    )
    const layerDefinitionsPath = classPaths.find((path) =>
      /net\/minecraft\/client\/model\/geom\/LayerDefinitions\.class$/i.test(path.replaceAll("\\", "/")),
    )
    if (!skullModelPath || !modelLayersPath || !layerDefinitionsPath) return null
    const skullModel = await readClassEvidence(options.readFile, skullModelPath, "m_170946_")
    const layerField = await findModelLayerField(options.readFile, modelLayersPath, skullLayerKey[skullKind])
    const definitionMethod =
      layerField && (await findLayerDefinitionMethod(options.readFile, layerDefinitionsPath, layerField))
    const headGeometry =
      definitionMethod && (await readLayerGeometry(options.readFile, skullModelPath, definitionMethod))
    const skullRenderer = await readClassEvidence(options.readFile, rendererPath, "createSkullRenderers")
    const renderMethod = await readClassEvidence(options.readFile, rendererPath, "render")
    if (
      !skullModel ||
      !headGeometry ||
      !layerField ||
      !skullRenderer?.some((line) => line.includes(`ModelLayers.${layerField}:`)) ||
      !skullRenderer.some((line) => line.includes("SkullModel.<init>")) ||
      !renderMethod?.some((line) => line.includes("BlockRenderDispatcher."))
    )
      return null
    const candle = await readModel("assets/minecraft/models/block/template_candle.json", options)
    if (!candle || !Array.isArray(candle.elements)) return null

    const elements = [...headGeometry.elements, ...candle.elements.map((element) => translateCandle(element))]
    return {
      json: {
        textures: {
          skull: skullTexture,
          all: "minecraft:block/candle",
          particle: "minecraft:block/candle",
        },
        elements,
      },
      diagnostics: [
        `通过静态渲染器关联恢复了${skullKind}头颅与蜡烛几何。`,
        `静态关联来源：${rendererPath} → ${layerField} → SkullModel.${definitionMethod}；cuboid与UV分辨率从原版 class Code 常量提取。`,
        `蜡烛来自 assets/minecraft/models/block/template_candle.json，按renderer translate(0,0.45,0) 上移7.2个模型单位。`,
        "蜡烛数量、颜色和点燃状态由BlockEntity决定；预览按一支蜡烛与默认贴图静态呈现。",
      ],
    }
  }
}

export function resolveImportedRuntimeModel(options: ResolverOptions & ImportedRuntimeModelInput) {
  const { entryPath, json, ...resolverOptions } = options
  return createImportedRuntimeResolver(resolverOptions)({ entryPath, json })
}

function resolveSkullKind(stem: string) {
  if (!/^(?!template_)[a-z0-9_]+_skull_candle$/i.test(stem)) return undefined
  const kind = stem.replace(/_skull_candle$/i, "")
  return skullLayerKey[kind] ? kind : undefined
}

async function readModel(path: string, options: ResolverOptions) {
  const actualPath = options.paths.find((candidate) => candidate.replaceAll("\\", "/").endsWith(path))
  if (!actualPath) return null
  try {
    const value: unknown = JSON.parse(decoder.decode(await options.readFile(actualPath)))
    return isObject(value) ? value : null
  } catch {
    return null
  }
}

function skullTexturePath(kind: string) {
  if (["zombie", "skeleton", "creeper", "wither_skeleton"].includes(kind))
    return `minecraft:entity/${kind === "wither_skeleton" ? "skeleton/wither_skeleton" : `${kind}/${kind}`}`
  return undefined
}

type ClassEvidence = {
  methods: { name: string; instructions?: string[]; truncated?: boolean }[]
  fields: { name: string; constant_value?: string }[]
  string_constants: string[]
}
const inspectJavaClass = async (
  readFile: ResolverOptions["readFile"],
  path: string,
  method?: string,
  options: { maxInstructions?: number } = {},
) => {
  const { inspectJavaClass } = await import("./class-inspect")
  return JSON.parse(inspectJavaClass(await readFile(path), method, options).content) as ClassEvidence
}

async function readClassEvidence(readFile: ResolverOptions["readFile"], path: string, method: string) {
  const evidence = await inspectJavaClass(readFile, path, method)
  const instructions = evidence.methods[0]?.instructions
  return instructions && !evidence.methods[0]?.truncated ? instructions : null
}

async function findModelLayerField(readFile: ResolverOptions["readFile"], path: string, layerKey: string | undefined) {
  if (!layerKey) return undefined
  const instructions = (await inspectJavaClass(readFile, path, "<clinit>")).methods[0]?.instructions ?? []
  const index = instructions.findIndex((line) => line.includes(`// ${layerKey}`))
  const match = instructions
    .slice(index + 1, index + 5)
    .join("\n")
    .match(/putstatic \S+ \/\/ net\/minecraft\/client\/model\/geom\/ModelLayers\.(\w+):/)
  return index < 0 ? undefined : match?.[1]
}

async function findLayerDefinitionMethod(readFile: ResolverOptions["readFile"], path: string, field: string) {
  const instructions =
    (await inspectJavaClass(readFile, path, "m_171110_", { maxInstructions: 4096 })).methods[0]?.instructions ?? []
  const methodByLocal = new Map<string, string>()
  instructions.forEach((line, index) => {
    const call = line.match(/invokestatic \S+ \/\/ net\/minecraft\/client\/model\/SkullModel\.(m_\d+_):/)
    const store = instructions[index + 1]?.match(/astore(?:_(\d+)| (\w+))$/)
    if (call && store) methodByLocal.set(store[1] ?? store[2]!, call[1]!)
  })
  const target = instructions.findIndex((line) => line.includes(`ModelLayers.${field}:`))
  if (target < 0) return undefined
  const load = instructions[target + 1]?.match(/aload(?:_(\d+)| (\w+))$/)
  const put = instructions[target + 2] ?? ""
  if (!load || !put.includes("ImmutableMap$Builder.put:")) return undefined
  return methodByLocal.get(load[1] ?? load[2]!)
}

async function readLayerGeometry(readFile: ResolverOptions["readFile"], path: string, method: string) {
  const base = await inspectJavaClass(readFile, path, "m_170946_")
  const layer = method === "m_170946_" ? base : await inspectJavaClass(readFile, path, method)
  const baseCubes = extractCubes(base.methods[0]?.instructions ?? [])
  const layerInstructions = layer.methods[0]?.instructions ?? []
  const additional = extractCubes(layerInstructions)
  const dimensionsAt = layerInstructions.findIndex((line) => line.includes("LayerDefinition.m_171565_:"))
  const textureWidth = numericConstant(layerInstructions[dimensionsAt - 2] ?? "")
  const textureHeight = numericConstant(layerInstructions[dimensionsAt - 1] ?? "")
  if (!baseCubes.length || !textureWidth || !textureHeight || dimensionsAt < 2) return null
  const cubes = method === "m_170947_" ? [...baseCubes, ...additional] : baseCubes
  return { elements: cubes.map((cube, index) => skullJsonElement(cube, index, textureWidth, textureHeight)) }
}

type ExtractedCube = {
  uv: [number, number]
  origin: [number, number, number]
  size: [number, number, number]
  inflate: number
}
function extractCubes(instructions: string[]): ExtractedCube[] {
  const cubes: ExtractedCube[] = []
  let uv: [number, number] | undefined,
    uvAt = -1
  instructions.forEach((line, index) => {
    if (line.includes("CubeListBuilder.m_171514_:(II)")) {
      const first = numericConstant(instructions[index - 2] ?? ""),
        second = numericConstant(instructions[index - 1] ?? "")
      if (first !== undefined && second !== undefined) {
        uv = [first, second]
        uvAt = index
      }
    }
    if (!line.includes("CubeListBuilder.m_171481_:") && !line.includes("CubeListBuilder.m_171488_:")) return
    const values = instructions.slice(uvAt + 1, index).flatMap((candidate) => {
      const value = numericConstant(candidate)
      return value === undefined ? [] : [value]
    })
    const deformation = line.includes("m_171488_") ? values[6] : 0
    if (uv && uvAt >= 0 && values.length >= 6)
      cubes.push({
        uv,
        origin: [values[0]!, values[1]!, values[2]!],
        size: [values[3]!, values[4]!, values[5]!],
        inflate: deformation ?? 0,
      })
  })
  return cubes
}

function numericConstant(line: string) {
  const value = line.split(": ").at(-1) ?? ""
  if (/^iconst_m1$/.test(value)) return -1
  if (/^iconst_\d$/.test(value)) return Number(value.at(-1))
  if (/^fconst_[012]$/.test(value)) return Number(value.at(-1))
  const push = line.match(/(?:bipush|sipush) ([\da-f]+)/)
  if (push) {
    const raw = Number.parseInt(push[1]!, 16)
    return push[0]!.startsWith("bipush") && raw > 127 ? raw - 256 : raw
  }
  const constant = line.match(/ldc(?:_w)? \S+ \/\/ (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i)
  return constant ? Number(constant[1]) : undefined
}

function skullJsonElement(cube: ExtractedCube, index: number, textureWidth: number, textureHeight: number) {
  const [x, y, z] = cube.origin,
    [width, height, depth] = cube.size,
    inflate = cube.inflate,
    [u, v] = cube.uv,
    fx = 16 / textureWidth,
    fy = 16 / textureHeight
  const face = (x: number, y: number, width: number, height: number) => ({
    uv: [x * fx, y * fy, (x + width) * fx, (y + height) * fy],
    texture: "#skull",
  })
  const east = face(u + depth + width, v + depth, depth, height),
    west = face(u, v + depth, depth, height),
    up = face(u + depth + width, v, width, depth),
    down = face(u + depth, v, width, depth)
  return {
    name: index ? `head_overlay_${index}` : "head",
    from: [8 - x - width - inflate, -y - height - inflate, 8 + z - inflate],
    to: [8 - x + inflate, -y + inflate, 8 + z + depth + inflate],
    faces: {
      north: face(u + depth, v + depth, width, height),
      east: west,
      south: face(u + depth + width + depth, v + depth, width, height),
      west: east,
      up: down,
      down: up,
    },
  }
}

function translateCandle(element: unknown) {
  if (!isObject(element) || !Array.isArray(element.from) || !Array.isArray(element.to)) return element
  return {
    ...element,
    from: [element.from[0], Number(element.from[1]) + 7.2, element.from[2]],
    to: [element.to[0], Number(element.to[1]) + 7.2, element.to[2]],
  }
}

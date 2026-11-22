import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { inspectJavaClass } from "./class-inspect"
import { createJarClassProvider } from "./import-vanilla"
import { createImportedAssetReader, getImportAssetRoot, ImportedAssetCatalogSchema } from "./import-assets"
import { getImportProject } from "./import-project"
import { assertNoReverseSymlink, extractReverseArchive, reverseFilePath } from "./reverse-archive"

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const analysisVersion = 2
const kinds = [
  "entity",
  "block",
  "item",
  "model",
  "texture",
  "audio",
  "sound",
  "animation",
  "dimension",
  "biome",
  "loot",
  "recipe",
  "effect",
  "class",
  "resource",
] as const
const edgeTypes = [
  "belongs_to",
  "uses_model",
  "uses_texture",
  "plays_sound",
  "has_animation",
  "spawns_in",
  "extends",
  "references",
] as const
const metadataValue = z.union([
  z.string().max(2048),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(2048)).max(100),
])
export const ImportAssetGraphEvidenceSchema = z.strictObject({
  sourcePath: z.string().max(2048),
  sourceAssetId: digest.nullable(),
  sha256: digest,
  method: z.enum(["catalog", "json", "class-inspect"]),
  instruction: z.string().max(4096).nullable(),
  jsonPointer: z.string().max(2048).nullable(),
  summary: z.string().max(4096),
})
export const ImportAssetGraphNodeSchema = z.strictObject({
  id: z.string().min(1).max(128),
  kind: z.enum(kinds),
  name: z.string().max(512),
  resourceId: z.string().max(1024).nullable(),
  sourceAssetId: digest.nullable(),
  sourcePath: z.string().max(2048).nullable(),
  metadata: z.record(z.string().max(128), metadataValue),
  evidence: z.array(ImportAssetGraphEvidenceSchema).max(100),
})
export const ImportAssetGraphEdgeSchema = z.strictObject({
  id: z.string().min(1).max(128),
  from: z.string().min(1).max(128),
  to: z.string().min(1).max(128),
  type: z.enum(edgeTypes),
  relationStatus: z.enum(["verified", "candidate"]),
  evidence: z.array(ImportAssetGraphEvidenceSchema).min(1).max(100),
})
export const ImportAssetGraphSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    analysisVersion: z.literal(analysisVersion),
    projectId: z.uuid(),
    catalogSha256: digest,
    generatedAt: z.iso.datetime(),
    nodes: z.array(ImportAssetGraphNodeSchema).max(100_000),
    edges: z.array(ImportAssetGraphEdgeSchema).max(500_000),
    coverage: z.strictObject({
      selectedAssets: z.number().int().nonnegative(),
      inspectedClasses: z.number().int().nonnegative(),
      availableClasses: z.number().int().nonnegative(),
      warnings: z.array(z.string().max(4096)).max(10_000),
    }),
    graphSha256: digest,
  })
  .superRefine((graph, context) => {
    const nodeIds = graph.nodes.map((node) => node.id)
    if (new Set(nodeIds).size !== nodeIds.length)
      context.addIssue({ code: "custom", message: "Asset graph contains duplicate node IDs" })
    const edgeIds = graph.edges.map((edge) => edge.id)
    if (new Set(edgeIds).size !== edgeIds.length)
      context.addIssue({ code: "custom", message: "Asset graph contains duplicate edge IDs" })
    const known = new Set(nodeIds)
    graph.edges.forEach((edge, index) => {
      if (!known.has(edge.from) || !known.has(edge.to))
        context.addIssue({ code: "custom", path: ["edges", index], message: "Asset graph contains a dangling edge" })
    })
  })
export type ImportAssetGraphEvidence = z.infer<typeof ImportAssetGraphEvidenceSchema>
export type ImportAssetGraphNode = z.infer<typeof ImportAssetGraphNodeSchema>
export type ImportAssetGraphEdge = z.infer<typeof ImportAssetGraphEdgeSchema>
export type ImportedAssetGraph = z.infer<typeof ImportAssetGraphSchema>

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const hashFile = async (filename: string) => {
  const digest = createHash("sha256")
  for await (const chunk of createReadStream(filename)) digest.update(chunk)
  return digest.digest("hex")
}
const jsonDigest = (value: unknown) => sha256(Buffer.from(JSON.stringify(value)))
const graphFile = (root: string) => path.join(root, "graph.json")
const graphId = (kind: string, key: string) => `node_${sha256(Buffer.from(`${kind}\0${key}`))}`
const pointerPart = (value: string | number) => String(value).replaceAll("~", "~0").replaceAll("/", "~1")
const normalizeResourceId = (value: string, defaultNamespace: string) => {
  const normalized = value
    .replace(/^#/, "")
    .replace(/\\/g, "/")
    .replace(/\.(?:json|png|ogg|wav|mp3|flac|m4a)$/i, "")
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) return null
  return normalized.includes(":") ? normalized : `${defaultNamespace}:${normalized}`
}
const normalizeForKind = (resourceId: string, kind: (typeof kinds)[number]) => {
  const [namespace, ...parts] = resourceId.split(":"),
    prefix =
      kind === "model"
        ? "models/"
        : kind === "texture"
          ? "textures/"
          : kind === "audio"
            ? "sounds/"
            : kind === "biome"
              ? "worldgen/biome/"
              : kind === "dimension"
                ? "dimension/"
                : kind === "loot"
                  ? "loot_tables/"
                  : kind === "recipe"
                    ? "recipes/"
                    : "",
    id = parts
      .join(":")
      .replace(new RegExp(`^${prefix}`, "i"), "")
      .replace(/\.(?:json|png|ogg|wav|mp3|flac|m4a)$/i, "")
  return namespace && id ? `${namespace}:${id}` : null
}
const resourceIdForAsset = (asset: z.infer<typeof ImportedAssetCatalogSchema>["assets"][number]) => {
  const match = asset.resourcePath.match(/^(?:assets|data)\/([^/]+)\/(.+)$/i)
  if (!match) return `${asset.namespace ?? "unknown"}:${asset.resourcePath.replace(/\\/g, "/")}`
  const resource = match[2]
    .replace(/^(?:models|textures|sounds|animations)\//i, "")
    .replace(/^(?:worldgen\/biome|dimension|loot_tables?|recipes?|mob_effects?)\//i, "")
    .replace(/\.(?:json|png|jpe?g|webp|tiff?|ogg|wav|mp3|flac|m4a)$/i, "")
  return `${match[1]}:${resource}`
}
const jsonKind = (asset: z.infer<typeof ImportedAssetCatalogSchema>["assets"][number]): (typeof kinds)[number] => {
  const lower = asset.resourcePath.toLowerCase()
  if (asset.kind === "model") return "model"
  if (asset.kind === "texture") return "texture"
  if (asset.kind === "audio") return "audio"
  if (asset.kind === "animation") return "animation"
  if (/(^|\/)worldgen\/biome\//.test(lower)) return "biome"
  if (/(^|\/)dimension\//.test(lower)) return "dimension"
  if (/(^|\/)loot_tables?\//.test(lower)) return "loot"
  if (/(^|\/)recipes?\//.test(lower)) return "recipe"
  if (/(^|\/)mob_effects?\//.test(lower)) return "effect"
  if (/(^|\/)blocks?\//.test(lower)) return "block"
  if (/(^|\/)items?\//.test(lower)) return "item"
  return "resource"
}
const evidence = (
  input: Omit<ImportAssetGraphEvidence, "instruction" | "jsonPointer"> & {
    instruction?: string | null
    jsonPointer?: string | null
  },
) => ImportAssetGraphEvidenceSchema.parse({ instruction: null, jsonPointer: null, ...input })

type GraphClassProvider = {
  sha256: string
  paths: string[]
  readFile: (name: string) => Promise<Uint8Array>
  verify?: () => Promise<boolean>
  dispose?: () => void
  warnings?: string[]
  sourcePathFor?: (name: string) => string
}
export async function buildGraph(input: {
  catalog: z.input<typeof ImportedAssetCatalogSchema>
  readBytes: (assetId: string) => Promise<Uint8Array>
  classProvider?: GraphClassProvider | null
}) {
  const catalog = ImportedAssetCatalogSchema.parse(input.catalog),
    nodes = new Map<string, ImportAssetGraphNode>(),
    edges = new Map<string, ImportAssetGraphEdge>(),
    warnings: string[] = [...(input.classProvider?.warnings ?? [])],
    languageValues = new Map<string, { value: string; proof: ImportAssetGraphEvidence }>(),
    assetsById = new Map(catalog.assets.map((asset) => [asset.id, asset])),
    resourceNodes = new Map<string, string>(),
    availableBiomeIds = new Set(catalog.assets.filter((asset) => jsonKind(asset) === "biome").map(resourceIdForAsset)),
    nodeEvidence = new Map<string, Map<string, ImportAssetGraphEvidence>>(),
    edgeEvidence = new Map<string, Map<string, ImportAssetGraphEvidence>>()

  const addNode = (inputNode: Omit<ImportAssetGraphNode, "id"> & { id?: string }) => {
    const key = `${inputNode.kind}\0${inputNode.resourceId ?? inputNode.sourceAssetId ?? inputNode.sourcePath ?? inputNode.name}`,
      id = inputNode.id ?? graphId(inputNode.kind, key),
      current = nodes.get(id),
      uniqueEvidence = new Map(
        [...(current?.evidence ?? []), ...inputNode.evidence].map((item) => [JSON.stringify(item), item]),
      ),
      sourceAssetIds = [
        ...new Set(
          [
            ...(Array.isArray(current?.metadata.sourceAssetIds)
              ? current.metadata.sourceAssetIds.filter((value): value is string => typeof value === "string")
              : []),
            current?.sourceAssetId,
            inputNode.sourceAssetId,
          ].filter((value): value is string => !!value),
        ),
      ],
      ambiguousSource = sourceAssetIds.length > 1,
      node = ImportAssetGraphNodeSchema.parse({
        ...current,
        ...inputNode,
        id,
        ...(!ambiguousSource
          ? {
              sourceAssetId: inputNode.sourceAssetId ?? current?.sourceAssetId ?? null,
              sourcePath: inputNode.sourceAssetId
                ? inputNode.sourcePath
                : (current?.sourcePath ?? inputNode.sourcePath),
            }
          : {}),
        ...(ambiguousSource
          ? {
              sourceAssetId: null,
              sourcePath: null,
              metadata: {
                ...current?.metadata,
                ...inputNode.metadata,
                available: true,
                ambiguousSource: true,
                sourceAssetIds,
              },
            }
          : {}),
        evidence: [...uniqueEvidence.values()],
      })
    nodes.set(id, node)
    if (node.resourceId) resourceNodes.set(`${node.kind}\0${node.resourceId}`, id)
    return id
  }
  const addEdge = (
    from: string,
    to: string,
    type: (typeof edgeTypes)[number],
    proof: ImportAssetGraphEvidence,
    relationStatus: "verified" | "candidate" = "verified",
  ) => {
    if (!nodes.has(from) || !nodes.has(to)) throw new Error("Cannot add asset graph edge with missing endpoint")
    if (nodes.get(from)?.metadata.ambiguousSource === true || nodes.get(to)?.metadata.ambiguousSource === true)
      relationStatus = "candidate"
    const id = `edge_${sha256(Buffer.from(`${from}\0${to}\0${type}`))}`,
      current = edges.get(id),
      uniqueEvidence = new Map([...(current?.evidence ?? []), proof].map((item) => [JSON.stringify(item), item]))
    edges.set(
      id,
      ImportAssetGraphEdgeSchema.parse({ id, from, to, type, relationStatus, evidence: [...uniqueEvidence.values()] }),
    )
  }
  const targetNode = (
    kind: (typeof kinds)[number],
    resourceId: string,
    sourceProof: ImportAssetGraphEvidence,
    metadata: ImportAssetGraphNode["metadata"] = { available: false },
  ) => {
    const normalized = normalizeForKind(resourceId, kind),
      existingId = resourceNodes.get(`${kind}\0${normalized}`)
    if (existingId) {
      const existing = nodes.get(existingId)!
      if (metadata.available === true && existing.metadata.available !== true)
        addNode({ ...existing, metadata: { ...existing.metadata, ...metadata }, evidence: [sourceProof] })
      return existingId
    }
    return addNode({
      kind,
      name: normalized ?? resourceId,
      resourceId: normalized,
      sourceAssetId: null,
      sourcePath: null,
      metadata,
      evidence: [sourceProof],
    })
  }

  for (const asset of catalog.assets) {
    const kind = jsonKind(asset),
      resourceId = resourceIdForAsset(asset),
      proof = evidence({
        sourcePath: asset.sourcePath,
        sourceAssetId: asset.id,
        sha256: asset.sha256,
        method: "catalog",
        summary: `所选资产目录记录：${asset.path}`,
      })
    addNode({
      kind,
      name: asset.name,
      resourceId,
      sourceAssetId: asset.id,
      sourcePath: asset.sourcePath,
      metadata: {
        available: true,
        path: asset.path,
        resourcePath: asset.resourcePath,
        format: asset.format,
        origin: asset.origin,
        ...(kind === "animation" ? { animationMode: "json" } : {}),
      },
      evidence: [proof],
    })
  }

  for (const asset of catalog.assets) {
    const lowerPath = asset.resourcePath.toLowerCase(),
      relevantJson =
        asset.kind === "model" ||
        asset.kind === "animation" ||
        /\.png\.mcmeta$/i.test(asset.resourcePath) ||
        lowerPath.endsWith("/sounds.json") ||
        /\/lang\/(?:zh_cn|en_us)\.json$/i.test(lowerPath) ||
        /\/(?:dimensions?|worldgen\/biome|loot_tables?|recipes?|mob_effects?)\//.test(lowerPath)
    if (
      asset.bytes > 1024 * 1024 ||
      (!/\.json$/i.test(asset.path) && !/\.png\.mcmeta$/i.test(asset.path)) ||
      !relevantJson
    )
      continue
    const bytes = await input.readBytes(asset.id)
    if (bytes.byteLength !== asset.bytes || sha256(bytes) !== asset.sha256)
      throw new Error(`Imported asset checksum mismatch during graph generation: ${asset.path}`)
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    } catch (error) {
      warnings.push(`JSON未能用于关系分析：${asset.path}（${error instanceof Error ? error.message : "解析失败"}）`)
      continue
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue
    const root = parsed as Record<string, unknown>,
      sourceKind = jsonKind(asset),
      sourceId = resourceNodes.get(`${sourceKind}\0${resourceIdForAsset(asset)}`)!,
      proofAt = (pointer: string, summary: string) =>
        evidence({
          sourcePath: asset.sourcePath,
          sourceAssetId: asset.id,
          sha256: asset.sha256,
          method: "json",
          jsonPointer: pointer,
          summary,
        }),
      namespace = asset.namespace ?? "unknown"

    if (/\/lang\/(?:zh_cn|en_us)\.json$/i.test(lowerPath)) {
      Object.entries(root).forEach(([key, value]) => {
        if (typeof value !== "string") return
        const previous = languageValues.get(key),
          isChinese = /\/zh_cn\.json$/i.test(lowerPath)
        if (!previous || (isChinese && !previous.proof.sourcePath.toLowerCase().endsWith("/zh_cn.json")))
          languageValues.set(key, {
            value,
            proof: proofAt(`/${pointerPart(key)}`, `语言文件 ${key} 提供名称：${value}`),
          })
      })
      continue
    }

    if (/\.png\.mcmeta$/i.test(asset.resourcePath)) {
      const animation = root.animation,
        texturePath = asset.resourcePath.slice(0, -".mcmeta".length),
        textureAssets = catalog.assets.filter(
          (candidate) => candidate.kind === "texture" && candidate.resourcePath === texturePath,
        ),
        textureAsset = textureAssets.find((candidate) => candidate.groupId === asset.groupId) ?? textureAssets[0]
      if (typeof animation === "object" && animation !== null && !Array.isArray(animation) && textureAsset) {
        const values = animation as Record<string, unknown>,
          proof = proofAt("/animation", "PNG mcmeta 声明贴图帧动画"),
          textureNode = resourceNodes.get(`texture\0${resourceIdForAsset(textureAsset)}`),
          animationNode = addNode({
            kind: "animation",
            name: `${textureAsset.name} 帧动画`,
            resourceId: `${resourceIdForAsset(textureAsset)}#texture_frames`,
            sourceAssetId: asset.id,
            sourcePath: asset.sourcePath,
            metadata: {
              animationMode: "texture_frames",
              ...(Array.isArray(values.frames) ? { frameCount: values.frames.length } : {}),
              ...(typeof values.frametime === "number" ? { frametime: values.frametime } : {}),
            },
            evidence: [proof],
          })
        if (textureNode) addEdge(textureNode, animationNode, "has_animation", proof)
      }
      continue
    }

    const addJsonTarget = (
      targetKind: (typeof kinds)[number],
      raw: string,
      pointer: string,
      type: (typeof edgeTypes)[number],
      summary: string,
    ) => {
      const resourceId = normalizeResourceId(raw, namespace)
      if (!resourceId) return
      const normalizedId = normalizeForKind(resourceId, targetKind)
      if (!normalizedId) return
      const proof = proofAt(pointer, summary),
        target = targetNode(targetKind, normalizedId, proof)
      addEdge(sourceId, target, type, proof)
    }

    if (sourceKind === "model") {
      if (typeof root.parent === "string")
        addJsonTarget("model", root.parent, "/parent", "uses_model", `模型父级：${root.parent}`)
      if (typeof root.model === "string")
        addJsonTarget("model", root.model, "/model", "uses_model", `模型引用：${root.model}`)
      if (root.textures && typeof root.textures === "object" && !Array.isArray(root.textures))
        Object.entries(root.textures).forEach(([key, value]) => {
          if (typeof value === "string" && !value.startsWith("#"))
            addJsonTarget(
              "texture",
              value,
              `/textures/${pointerPart(key)}`,
              "uses_texture",
              `贴图字段 ${key} 指向 ${value}`,
            )
        })
      if (Array.isArray(root.animations))
        root.animations.forEach((value, index) => {
          if (typeof value === "string")
            addJsonTarget("animation", value, `/animations/${index}`, "has_animation", `动画引用：${value}`)
        })
    }

    if (/\/sounds\.json$/i.test(asset.resourcePath) && sourceKind === "resource") {
      for (const [eventName, eventValue] of Object.entries(root)) {
        const soundId = normalizeResourceId(eventName, namespace)
        if (!soundId) continue
        const eventProof = proofAt(`/${pointerPart(eventName)}`, `sounds.json 声音事件：${eventName}`),
          soundNode = targetNode("sound", soundId, eventProof, { available: true })
        addEdge(sourceId, soundNode, "references", eventProof)
        const entries =
          typeof eventValue === "object" && eventValue !== null && !Array.isArray(eventValue)
            ? (eventValue as Record<string, unknown>).sounds
            : undefined
        if (!Array.isArray(entries)) continue
        entries.forEach((entry, index) => {
          const raw =
            typeof entry === "string"
              ? entry
              : typeof entry === "object" && entry !== null
                ? (entry as Record<string, unknown>).name
                : null
          if (typeof raw !== "string") return
          const targetIsEvent =
              typeof entry === "object" && entry !== null && (entry as Record<string, unknown>).type === "event",
            audioId = normalizeResourceId(raw, namespace)
          if (!audioId) return
          const pointer = `/${pointerPart(eventName)}/sounds/${index}${typeof entry === "string" ? "" : "/name"}`,
            proof = proofAt(pointer, `声音事件 ${eventName} 声明音频：${raw}`),
            target = targetNode(targetIsEvent ? "sound" : "audio", audioId, proof)
          addEdge(soundNode, target, "plays_sound", proof)
        })
      }
    }

    if (sourceKind === "dimension") {
      const visitBiomes = (value: unknown, pointer: string) => {
        const addBiome = (raw: string, at: string) => {
          const id = normalizeResourceId(raw, namespace)
          if (!id) return
          const proof = proofAt(at, `dimension JSON 直接声明 biome：${raw}`),
            target = targetNode("biome", id, proof)
          addEdge(sourceId, target, "references", proof)
          addEdge(target, sourceId, "belongs_to", proof)
        }
        if (typeof value === "string") {
          addBiome(value, pointer)
          return
        }
        if (!Array.isArray(value)) return
        value.forEach((item, index) => {
          const itemPointer = `${pointer}/${index}`
          if (typeof item === "string") addBiome(item, itemPointer)
          if (typeof item === "object" && item !== null && !Array.isArray(item)) {
            const biome = (item as Record<string, unknown>).biome
            if (typeof biome === "string") addBiome(biome, `${itemPointer}/biome`)
          }
        })
      }
      const visit = (value: unknown, pointer: string, inBiomeField = false) => {
        if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${pointer}/${index}`, inBiomeField))
        if (typeof value !== "object" || value === null || Array.isArray(value)) return
        Object.entries(value).forEach(([key, item]) => {
          const child = `${pointer}/${pointerPart(key)}`,
            isBiome = /^(?:biome|biomes)$/i.test(key)
          if (isBiome) visitBiomes(item, child)
          else visit(item, child, inBiomeField)
        })
      }
      visit(root, "")
      const visitBiomeSource = (value: unknown, pointer: string) => {
        if (Array.isArray(value)) {
          value.forEach((item, index) => visitBiomeSource(item, `${pointer}/${index}`))
          return
        }
        if (typeof value !== "object" || value === null) return
        Object.entries(value).forEach(([key, item]) => {
          const child = `${pointer}/${pointerPart(key)}`
          if (typeof item === "string") {
            const id = normalizeResourceId(item, namespace)
            if (!id || !availableBiomeIds.has(normalizeForKind(id, "biome") ?? "")) return
            const proof = proofAt(child, `dimension biome_source 明确引用已选中的 biome：${item}`),
              biome = targetNode("biome", id, proof)
            addEdge(sourceId, biome, "references", proof)
            addEdge(biome, sourceId, "belongs_to", proof)
            return
          }
          visitBiomeSource(item, child)
        })
      }
      const biomeSource = (root.generator as Record<string, unknown> | undefined)?.wrapped_generator
      if (typeof biomeSource === "object" && biomeSource !== null) {
        const source = (biomeSource as Record<string, unknown>).biome_source
        if (typeof source === "object" && source !== null)
          visitBiomeSource(source, "/generator/wrapped_generator/biome_source")
      }
    }

    if (sourceKind === "biome" && root.spawners && typeof root.spawners === "object") {
      const spawners = root.spawners as Record<string, unknown>
      Object.entries(spawners).forEach(([category, list]) => {
        if (!Array.isArray(list)) return
        list.forEach((entry, index) => {
          if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return
          const entity = (entry as Record<string, unknown>).type
          if (typeof entity !== "string") return
          const resourceId = normalizeResourceId(entity, namespace)
          if (!resourceId) return
          const pointer = `/spawners/${pointerPart(category)}/${index}/type`,
            proof = proofAt(pointer, `biome spawner ${category} 声明实体类型：${entity}`),
            target = targetNode("entity", resourceId, proof)
          addEdge(target, sourceId, "spawns_in", proof)
        })
      })
    }

    if (sourceKind === "recipe") {
      const visitIngredient = (value: unknown, pointer: string) => {
        if (Array.isArray(value)) {
          value.forEach((item, index) => visitIngredient(item, `${pointer}/${index}`))
          return
        }
        if (typeof value !== "object" || value === null) return
        const object = value as Record<string, unknown>
        if (typeof object.item === "string")
          addJsonTarget("item", object.item, `${pointer}/item`, "references", `配方明确引用物品：${object.item}`)
        Object.entries(object).forEach(([key, item]) => {
          if (key === "tag" || key === "item") return
          if (typeof item === "object" && item !== null) visitIngredient(item, `${pointer}/${pointerPart(key)}`)
        })
      }
      visitIngredient(root.ingredients, "/ingredients")
      visitIngredient(root.key, "/key")
      const result = root.result
      if (typeof result === "string") addJsonTarget("item", result, "/result", "references", `配方产出物品：${result}`)
      if (typeof result === "object" && result !== null && !Array.isArray(result)) {
        const item = (result as Record<string, unknown>).item ?? (result as Record<string, unknown>).id
        if (typeof item === "string")
          addJsonTarget(
            "item",
            item,
            `/result/${"item" in result ? "item" : "id"}`,
            "references",
            `配方产出物品：${item}`,
          )
      }
    }
  }

  const classProvider = input.classProvider
  let inspectedClasses = 0
  if (classProvider) {
    if (classProvider.verify && !(await classProvider.verify()))
      throw new Error("class-inspect source checksum mismatch")
    if (classProvider.paths.length > 10_000) warnings.push("class-inspect 可用类超过 10,000 个，已截断静态检查范围。")
    const classRecords = new Map<
        string,
        {
          path: string
          bytes: Uint8Array
          proof: ImportAssetGraphEvidence
          nodeId: string
          info: {
            name: string
            superclass: string | null
            interfaces: string[]
            fields: { name: string; descriptor: string; constant_value?: string }[]
            methods: { name: string; descriptor: string; instructions?: string[] }[]
            available_methods: string[]
            bootstrap_methods?: { index: number; arguments: string[] }[]
          }
        }
      >(),
      classPaths = new Set(classProvider.paths),
      inspectClass = async (internalName: string, methodName?: string) => {
        const record = classRecords.get(internalName)
        if (record) {
          const inspected = JSON.parse(inspectJavaClass(record.bytes, methodName).content) as typeof record.info
          return { ...record, inspected }
        }
        const classPath = `${internalName}.class`
        if (!classPaths.has(classPath)) return null
        const bytes = await classProvider.readFile(classPath),
          evidencePath = classProvider.sourcePathFor?.(classPath) ?? classPath
        if (bytes.byteLength > 8 * 1024 * 1024) return null
        const inspected = JSON.parse(inspectJavaClass(bytes, methodName).content) as typeof classRecords extends Map<
            string,
            infer T
          >
            ? T extends { info: infer I }
              ? I
              : never
            : never,
          classProof = evidence({
            sourcePath: evidencePath,
            sourceAssetId: null,
            sha256: sha256(bytes),
            method: "class-inspect",
            summary: `class-inspect 静态读取 ${classPath}（未执行）`,
          }),
          nodeId = addNode({
            kind: "class",
            name: inspected.name.replaceAll("/", "."),
            resourceId: inspected.name.replaceAll("/", "."),
            sourceAssetId: null,
            sourcePath: evidencePath,
            metadata: { superclass: inspected.superclass ?? "", interfaces: inspected.interfaces },
            evidence: [classProof],
          }),
          created = { path: evidencePath, bytes, proof: classProof, nodeId, info: inspected }
        classRecords.set(inspected.name, created)
        return { ...created, inspected }
      }
    for (const classPath of classProvider.paths.slice(0, 10_000)) {
      if (!classPath.endsWith(".class")) continue
      const bytes = await classProvider.readFile(classPath),
        evidencePath = classProvider.sourcePathFor?.(classPath) ?? classPath
      if (bytes.byteLength > 8 * 1024 * 1024) {
        warnings.push(`class-inspect跳过超过8 MiB的类：${classPath}`)
        continue
      }
      try {
        const evidenceText = inspectJavaClass(bytes).content,
          inspected = JSON.parse(evidenceText) as {
            name: string
            superclass: string | null
            interfaces: string[]
            fields: { name: string; descriptor: string; constant_value?: string }[]
            methods: { name: string; descriptor: string; instructions?: string[] }[]
            available_methods: string[]
            bootstrap_methods?: { index: number; arguments: string[] }[]
          },
          classProof = evidence({
            sourcePath: evidencePath,
            sourceAssetId: null,
            sha256: sha256(bytes),
            method: "class-inspect",
            summary: `class-inspect 静态读取 ${classPath}（未执行）`,
          }),
          className = inspected.name.replaceAll("/", "."),
          classNode = addNode({
            kind: "class",
            name: className,
            resourceId: inspected.name.replaceAll("/", "."),
            sourceAssetId: null,
            sourcePath: evidencePath,
            metadata: { superclass: inspected.superclass ?? "", interfaces: inspected.interfaces },
            evidence: [classProof],
          })
        inspectedClasses++
        classRecords.set(inspected.name, {
          path: evidencePath,
          bytes,
          proof: classProof,
          nodeId: classNode,
          info: inspected,
        })
        const animationMethods = inspected.available_methods.filter(
          (name) => name === "setupAnim" || name === "m_6973_",
        )
        for (const methodName of animationMethods) {
          const methodBytes = inspectJavaClass(bytes, methodName).content,
            selected = JSON.parse(methodBytes) as { methods: { instructions?: string[] }[] },
            instruction = selected.methods[0]?.instructions?.join("\n") ?? "",
            methodProof = evidence({
              sourcePath: evidencePath,
              sourceAssetId: null,
              sha256: sha256(bytes),
              method: "class-inspect",
              instruction: instruction.slice(0, 4096),
              summary: `class-inspect 发现程序化动画方法 ${methodName}；未将其作为 JSON 时间轴`,
            }),
            animationId = addNode({
              kind: "animation",
              name: `${className}.${methodName}`,
              resourceId: `${inspected.name.replaceAll("/", ".")}#${methodName}`,
              sourceAssetId: null,
              sourcePath: evidencePath,
              metadata: { animationMode: "programmatic", methodName },
              evidence: [methodProof],
            })
          addEdge(classNode, animationId, "has_animation", methodProof)
        }
      } catch (error) {
        warnings.push(`class-inspect未能分析 ${classPath}：${error instanceof Error ? error.message : "读取失败"}`)
      }
    }

    const resourceLocationIds = new Map<string, { resourceId: string; proofs: ImportAssetGraphEvidence[] }>(),
      soundEventByField = new Map<string, { resourceId: string; proof: ImportAssetGraphEvidence }>(),
      registeredEntityByField = new Map<string, string>()
    for (const record of classRecords.values()) {
      if (!record.info.available_methods.includes("<clinit>")) continue
      const initialized = await inspectClass(record.info.name, "<clinit>").catch(() => null),
        instructions = initialized?.inspected.methods[0]?.instructions ?? []
      if (
        record.info.fields.some((field) => field.descriptor.includes("RegistryObject")) &&
        instructions.some((line) => line.includes("createEvent:"))
      ) {
        const registrationIndex = instructions.findIndex((line) => line.includes("DeferredRegister.create:")),
          namespaceLine =
            registrationIndex < 0
              ? undefined
              : [...instructions.slice(0, registrationIndex)]
                  .reverse()
                  .find((line) => /\bldc(?:_w)? [\da-f]+ \/\/ (?:String )?([\w.-]+)$/.test(line)),
          namespace = namespaceLine?.match(/\bldc(?:_w)? [\da-f]+ \/\/ (?:String )?([\w.-]+)$/)?.[1]
        for (let index = 0; index < instructions.length; index++) {
          const line = instructions[index]!
          if (!line.includes("createEvent:")) continue
          const eventLine = [...instructions.slice(0, index)]
              .reverse()
              .find((value) => /\bldc(?:_w)? [\da-f]+ \/\/ (?:String )?[^ ]/.test(value)),
            fieldLine = instructions
              .slice(index + 1, index + 5)
              .find((value) => value.includes("putstatic") && value.includes("RegistryObject;")),
            eventName = eventLine?.match(/\bldc(?:_w)? [\da-f]+ \/\/ (?:String )?(.+)$/)?.[1],
            field = fieldLine?.match(/putstatic [\da-f]+ \/\/ ([\w/$]+)\.([\w$]+):/)
          if (!namespace || !eventName || !field) continue
          const resourceId = normalizeResourceId(eventName, namespace)
          if (!resourceId) continue
          const proof = evidence({
            sourcePath: record.path,
            sourceAssetId: null,
            sha256: sha256(record.bytes),
            method: "class-inspect",
            instruction: instructions
              .slice(Math.max(0, index - 2), Math.min(instructions.length, index + 3))
              .join("\n"),
            summary: `静态声音注册 helper ${record.info.name}.${line.match(/\.([\w$]+):/)?.[1]} 将事件 ${eventName} 写入字段 ${field[2]}`,
          })
          soundEventByField.set(`${field[1]}.${field[2]}`, { resourceId, proof })
          addNode({
            kind: "sound",
            name: eventName,
            resourceId,
            sourceAssetId: null,
            sourcePath: record.path,
            metadata: { available: true, registryField: `${field[1]}.${field[2]}` },
            evidence: [proof],
          })
        }
      }
      let start = 0
      for (let index = 0; index < instructions.length; index++) {
        const line = instructions[index]!,
          field = line.match(
            /putstatic [\da-f]+ \/\/ ([\w/$]+)\.([\w$]+):Lnet\/minecraft\/resources\/ResourceLocation;/,
          )
        if (!field) continue
        const range = instructions.slice(start, index + 1),
          prefixCall = range.find((item) =>
            /invokestatic .*:\(Ljava\/lang\/String;\)Lnet\/minecraft\/resources\/ResourceLocation;/.test(item),
          ),
          prefixOwner = prefixCall?.match(
            /\/\/ ([\w/$]+)\.[\w$]+:\(Ljava\/lang\/String;\)Lnet\/minecraft\/resources\/ResourceLocation;/,
          )?.[1],
          literalLine = [...range].reverse().find((item) => /\bldc(?:_w)? [\da-f]+ \/\//.test(item)),
          literal = literalLine?.match(/\bldc(?:_w)? [\da-f]+ \/\/ (.+)$/)?.[1]
        let namespace: string | undefined, prefixProof: ImportAssetGraphEvidence | undefined
        if (prefixOwner) {
          const helper = await inspectClass(prefixOwner),
            prefixMethod = helper?.info.methods.find(
              (method) => method.name === prefixCall?.match(/\.([\w$]+):\(/)?.[1],
            )?.name,
            body = prefixMethod ? await inspectClass(prefixOwner, prefixMethod).catch(() => null) : null,
            bodyLines = body?.inspected.methods[0]?.instructions ?? [],
            namespaceLine = bodyLines.find(
              (item) =>
                /\bldc(?:_w)? [\da-f]+ \/\/ /.test(item) &&
                bodyLines.indexOf(item) <
                  bodyLines.findIndex((candidate) => candidate.includes("ResourceLocation.<init>")),
            )
          namespace = namespaceLine?.match(/\bldc(?:_w)? [\da-f]+ \/\/ (.+)$/)?.[1]
          if (body && namespaceLine)
            prefixProof = evidence({
              sourcePath: body.path,
              sourceAssetId: null,
              sha256: sha256(body.bytes),
              method: "class-inspect",
              instruction: bodyLines.join("\n").slice(0, 4096),
              summary: `ResourceLocation prefix helper ${prefixOwner}.${prefixMethod} uses namespace ${namespace}`,
            })
        }
        if (literal && (namespace || literal.includes(":"))) {
          const resourceId = literal.includes(":") ? literal : `${namespace}:${literal}`,
            proof = evidence({
              sourcePath: record.path,
              sourceAssetId: null,
              sha256: sha256(record.bytes),
              method: "class-inspect",
              instruction: range.slice(-4).join("\n"),
              summary: `静态初始化将常量 ${literal} 写入 ${field[1]}.${field[2]} ResourceLocation 字段`,
            })
          resourceLocationIds.set(`${field[1]}\0${field[2]}`, {
            resourceId,
            proofs: [proof, ...(prefixProof ? [prefixProof] : [])],
          })
        }
        start = index + 1
      }
    }

    for (const record of classRecords.values()) {
      if (!record.info.available_methods.includes("<clinit>")) continue
      const initialized = await inspectClass(record.info.name, "<clinit>").catch(() => null),
        lines = initialized?.inspected.methods[0]?.instructions ?? [],
        bootstraps = initialized?.inspected.bootstrap_methods ?? []
      let segmentStart = 0
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!,
          helperCall = line.match(
            /invokestatic [\da-f]+ \/\/ [\w/$]+\.[\w$]+:\([^\n]*EntityType\$EntityFactory;[^\n]*MobCategory[^\n]*\)Lnet\/minecraftforge\/registries\/RegistryObject;/,
          )
        if (!helperCall) {
          if (/putstatic [\da-f]+ \/\/ [\w/$]+\.[\w$]+:Lnet\/minecraftforge\/registries\/RegistryObject;/.test(line))
            segmentStart = index + 1
          continue
        }
        const end = lines
            .slice(index + 1)
            .findIndex((candidate) =>
              /putstatic [\da-f]+ \/\/ [\w/$]+\.([\w$]+):Lnet\/minecraftforge\/registries\/RegistryObject;/.test(
                candidate,
              ),
            ),
          segmentEnd = end < 0 ? index : index + 1 + end,
          segment = lines.slice(segmentStart, segmentEnd + 1),
          registryLine = lines[segmentEnd],
          registration = registryLine?.match(
            /putstatic [\da-f]+ \/\/ ([\w/$]+)\.([\w$]+):Lnet\/minecraftforge\/registries\/RegistryObject;/,
          ),
          resourceLine = [...segment]
            .reverse()
            .find((candidate) =>
              /getstatic [\da-f]+ \/\/ [\w/$]+\.[\w$]+:Lnet\/minecraft\/resources\/ResourceLocation;/.test(candidate),
            ),
          nameField = resourceLine?.match(
            /getstatic [\da-f]+ \/\/ ([\w/$]+)\.([\w$]+):Lnet\/minecraft\/resources\/ResourceLocation;/,
          ),
          entityResource = nameField ? resourceLocationIds.get(`${nameField[1]}\0${nameField[2]}`) : undefined,
          category = segment
            .find((candidate) => /getstatic [\da-f]+ \/\/ net\/minecraft\/world\/entity\/MobCategory\./.test(candidate))
            ?.match(/MobCategory\.([\w$]+):/)?.[1],
          dynamic = [...segment].reverse().find((candidate) => candidate.includes("invokedynamic")),
          bootstrapIndex = Number(dynamic?.match(/bootstrap#(\d+)/)?.[1]),
          bootstrap = bootstraps.find((candidate) => candidate.index === bootstrapIndex),
          factory = bootstrap?.arguments.find((argument) => /handle#\d+ [\w/$]+\.<init>:\(/.test(argument)),
          entityClass = factory?.match(/handle#\d+ ([\w/$]+)\.<init>:/)?.[1],
          hasEntityFactoryDescriptor = bootstrap?.arguments.some((argument) =>
            argument.includes("Lnet/minecraft/world/entity/Entity;"),
          )
        if (!registration || !entityResource || !category || !entityClass || !hasEntityFactoryDescriptor) {
          segmentStart = segmentEnd + 1
          index = segmentEnd
          continue
        }
        const registrationProof = evidence({
            sourcePath: record.path,
            sourceAssetId: null,
            sha256: sha256(record.bytes),
            method: "class-inspect",
            instruction: segment.slice(-12).join("\n"),
            summary: `静态注册字段 ${registration[1]}.${registration[2]} 将 ResourceLocation、MobCategory 与实体工厂传给注册 helper`,
          }),
          registrationResourceId = targetNode("entity", entityResource.resourceId, registrationProof, {
            mobCategory: category,
            className: entityClass.replaceAll("/", "."),
          }),
          concreteClass = await inspectClass(entityClass).catch(() => null),
          concreteNode =
            concreteClass?.nodeId ??
            addNode({
              kind: "class",
              name: entityClass.replaceAll("/", "."),
              resourceId: entityClass.replaceAll("/", "."),
              sourceAssetId: null,
              sourcePath: `${entityClass}.class`,
              metadata: {},
              evidence: [registrationProof],
            })
        const entityNode = addNode({
          kind: "entity",
          name: entityClass.split("/").at(-1) ?? entityClass,
          resourceId: entityResource.resourceId,
          sourceAssetId: null,
          sourcePath: record.path,
          metadata: { available: true, mobCategory: category, className: entityClass.replaceAll("/", ".") },
          evidence: [...entityResource.proofs, registrationProof],
        })
        addEdge(registrationResourceId, concreteNode, "references", registrationProof)
        registeredEntityByField.set(`${registration[1]}.${registration[2]}`, entityNode)
        if (concreteClass) {
          for (const method of concreteClass.info.methods) {
            if (!concreteClass.info.available_methods.includes(method.name)) continue
            const selectedMethod = await inspectClass(entityClass, method.name).catch(() => null),
              methodInstructions =
                selectedMethod?.inspected.methods.find((candidate) => candidate.name === method.name)?.instructions ??
                []
            for (const instruction of methodInstructions) {
              const field = instruction.match(/getstatic [\da-f]+ \/\/ ([\w/$]+)\.([\w$]+):/),
                sound = field ? soundEventByField.get(`${field[1]}.${field[2]}`) : undefined
              if (!field || !sound) continue
              const soundNode = targetNode("sound", sound.resourceId, sound.proof, {
                  available: true,
                  registryField: `${field[1]}.${field[2]}`,
                }),
                proof = evidence({
                  sourcePath: concreteClass.path,
                  sourceAssetId: null,
                  sha256: sha256(concreteClass.bytes),
                  method: "class-inspect",
                  instruction: methodInstructions.join("\n").slice(0, 4096),
                  summary: `实体实现 ${entityClass}.${method.name} 直接读取声音注册字段 ${field[1]}.${field[2]}`,
                })
              addEdge(entityNode, soundNode, "plays_sound", proof)
            }
          }
        }
        segmentStart = segmentEnd + 1
        index = segmentEnd
      }
    }

    for (const record of classRecords.values()) {
      for (const method of record.info.methods.filter((candidate) =>
        candidate.descriptor.includes("EntityRenderersEvent$RegisterRenderers"),
      )) {
        const selected = await inspectClass(record.info.name, method.name).catch(() => null),
          instructions =
            selected?.inspected.methods.find((candidate) => candidate.name === method.name)?.instructions ?? [],
          bootstraps = selected?.inspected.bootstrap_methods ?? []
        for (let index = 0; index < instructions.length; index++) {
          if (!instructions[index]?.includes("registerEntityRenderer:")) continue
          const beginFromEnd = [...instructions.slice(0, index)]
              .reverse()
              .findIndex((line) =>
                /getstatic [\da-f]+ \/\/ [\w/$]+\.[\w$]+:Lnet\/minecraftforge\/registries\/RegistryObject;/.test(line),
              ),
            begin = beginFromEnd < 0 ? -1 : index - beginFromEnd - 1,
            field =
              begin < 0
                ? null
                : instructions[begin]?.match(
                    /getstatic [\da-f]+ \/\/ ([\w/$]+)\.([\w$]+):Lnet\/minecraftforge\/registries\/RegistryObject;/,
                  ),
            entityNode = field ? registeredEntityByField.get(`${field[1]}.${field[2]}`) : undefined,
            sequence = begin < 0 ? [] : instructions.slice(begin, index + 1),
            dynamic = [...sequence].reverse().find((line) => line.includes("invokedynamic")),
            bootstrapIndex = Number(dynamic?.match(/bootstrap#(\d+)/)?.[1]),
            bootstrap = bootstraps.find((candidate) => candidate.index === bootstrapIndex),
            rendererHandle = bootstrap?.arguments.find((argument) =>
              /handle#\d+ [\w/$]+\.(?:<init>|[\w$]+):/.test(argument),
            ),
            factoryOwner = rendererHandle?.match(/handle#\d+ ([\w/$]+)\.[\w$]+:/)?.[1],
            factoryMethod = rendererHandle?.match(/handle#\d+ [\w/$]+\.(<init>|[\w$]+):/)?.[1],
            rendererDescriptor = bootstrap?.arguments.find((argument) => argument.includes("EntityRenderer;"))
          if (!entityNode || !factoryOwner || !factoryMethod || !rendererDescriptor) continue
          const proof = evidence({
              sourcePath: record.path,
              sourceAssetId: null,
              sha256: sha256(record.bytes),
              method: "class-inspect",
              instruction: sequence.slice(-8).join("\n"),
              summary: `静态客户端方法 ${method.name} 将实体注册字段传给 registerEntityRenderer，并引用 renderer factory ${factoryOwner}.${factoryMethod}`,
            }),
            factory = await inspectClass(factoryOwner, factoryMethod).catch(() => null),
            factoryMethodInfo = factory?.inspected.methods.find((candidate) => candidate.name === factoryMethod),
            factoryInstructions = factoryMethodInfo?.instructions ?? [],
            constructed = [
              ...new Set(factoryInstructions.flatMap((line) => line.match(/new [\da-f]+ \/\/ ([\w/$]+)/)?.[1] ?? [])),
            ],
            rendererClasses =
              factoryMethod === "<init>"
                ? [factoryOwner]
                : (
                    await Promise.all(
                      constructed.map(async (internalName) => ({
                        internalName,
                        entry: await inspectClass(internalName).catch(() => null),
                      })),
                    )
                  )
                    .filter(
                      ({ internalName, entry }) =>
                        entry?.info.superclass?.includes("/client/renderer/entity/") &&
                        factoryInstructions.some((line) => line.includes(`${internalName}.<init>:`)),
                    )
                    .map(({ internalName }) => internalName)
          for (const rendererClass of rendererClasses) {
            const renderer = await inspectClass(rendererClass).catch(() => null)
            if (!renderer || !factory) continue
            const rendererNode = addNode({
              kind: "class",
              name: `${rendererClass.replaceAll("/", ".")}（${factoryOwner}.${factoryMethod}）`,
              resourceId: `${rendererClass.replaceAll("/", ".")}#${factoryOwner}.${factoryMethod}`,
              sourceAssetId: null,
              sourcePath: factory.path,
              metadata: {
                available: true,
                className: rendererClass.replaceAll("/", "."),
                factoryClass: factoryOwner.replaceAll("/", "."),
                factoryMethod,
              },
              evidence: [renderer.proof, proof],
            })
            addEdge(entityNode, rendererNode, "references", proof)
            const rendererConstructor = factoryInstructions.find((line) => line.includes(`${rendererClass}.<init>:`)),
              declaredModels = [
                ...(rendererConstructor?.match(/<init>:\(([^)]*)\)V/)?.[1] ?? "").matchAll(/L([\w/$]+Model);/g),
              ]
                .map((match) => match[1]!)
                .filter(
                  (modelClass) =>
                    factoryInstructions.some((line) => line.includes(`new `) && line.includes(`// ${modelClass}`)) &&
                    factoryInstructions.some((line) => line.includes(`${modelClass}.<init>:`)),
                ),
              modelClasses = declaredModels.length
                ? declaredModels
                : [
                    ...new Set(
                      factoryInstructions.flatMap((line) => {
                        const call = line.match(/invokespecial [\da-f]+ \/\/ ([\w/$]+)\.<init>:\(([^)]*)\)V/)
                        return call?.[2].includes("Lnet/minecraft/client/model/geom/ModelPart;") ? [call[1]] : []
                      }),
                    ),
                  ]
            for (const modelClass of modelClasses) {
              const modelRecord = await inspectClass(modelClass).catch(() => null)
              if (!modelRecord) continue
              const modelProof = evidence({
                  sourcePath: factory.path,
                  sourceAssetId: null,
                  sha256: sha256(factory.bytes),
                  method: "class-inspect",
                  instruction: factoryInstructions.filter((line) => line.includes(`${modelClass}.<init>:`)).join("\n"),
                  summary: `renderer factory ${factoryOwner}.${factoryMethod} 直接构造 model class ${modelClass}`,
                }),
                modelNode = addNode({
                  kind: "model",
                  name: modelClass.split("/").at(-1) ?? modelClass,
                  resourceId: modelClass.replaceAll("/", "."),
                  sourceAssetId: null,
                  sourcePath: modelRecord.path,
                  metadata: { available: true, className: modelClass.replaceAll("/", ".") },
                  evidence: [modelRecord.proof, modelProof],
                })
              addEdge(rendererNode, modelNode, "uses_model", modelProof)
              for (const animation of [...nodes.values()].filter(
                (node) =>
                  node.kind === "animation" &&
                  node.sourcePath === modelRecord.path &&
                  node.metadata.animationMode === "programmatic",
              )) {
                const animationProof = animation.evidence[0]
                if (animationProof) addEdge(modelNode, animation.id, "has_animation", animationProof)
              }
            }
            const constructor = await inspectClass(rendererClass, "<init>").catch(() => null),
              helperCall = constructor?.inspected.methods[0]?.instructions?.find((line) =>
                line.includes("getModelTexture:"),
              ),
              helper = helperCall?.match(/\/\/ ([\w/$]+)\.([\w$]+):/),
              strings = factoryInstructions.flatMap(
                (line) => line.match(/ldc_w? [\da-f]+ \/\/ (?:String )?(.+)$/)?.[1] ?? [],
              )
            if (helper && strings.length) {
              const textureHelper = await inspectClass(helper[1], helper[2]).catch(() => null),
                recipe = textureHelper?.inspected.bootstrap_methods
                  ?.flatMap((item) => item.arguments)
                  .find((value) => value.includes("\u0001")),
                namespace = textureHelper?.inspected.methods[0]?.instructions
                  ?.map((line) => line.match(/ldc [\da-f]+ \/\/ (?:String )?([\w.-]+)$/)?.[1])
                  .find(Boolean)
              if (recipe && namespace) {
                for (const literal of strings) {
                  if (/^(?:0|[0-9.]+)$/.test(literal)) continue
                  const resolved = `${namespace}:${recipe.replace("\u0001", literal)}`,
                    texture = targetNode("texture", resolved, proof, { available: false }),
                    helperProof = evidence({
                      sourcePath: textureHelper!.path,
                      sourceAssetId: null,
                      sha256: sha256(textureHelper!.bytes),
                      method: "class-inspect",
                      instruction: [
                        ...(constructor?.inspected.methods[0]?.instructions ?? []),
                        ...(textureHelper?.inspected.methods[0]?.instructions ?? []),
                      ]
                        .join("\n")
                        .slice(0, 4096),
                      summary: `renderer constructor delegates texture resolution to ${helper[1]}.${helper[2]} whose bytecode defines namespace and path template`,
                    })
                  addEdge(rendererNode, texture, "uses_texture", proof)
                  addEdge(rendererNode, texture, "uses_texture", helperProof)
                }
              }
            }
          }
        }
      }
    }
    if (classProvider.verify && !(await classProvider.verify()))
      throw new Error("class-inspect source checksum mismatch")
  } else warnings.push("没有可用的原始或已还原 class-inspect provider；实体注册、继承和程序化动画覆盖不完整。")

  for (const node of [...nodes.values()]) {
    if (!node.resourceId || !["entity", "item", "block", "effect", "biome"].includes(node.kind)) continue
    const key = `${node.kind}.${node.resourceId.replace(":", ".")}`,
      localized = languageValues.get(key)
    if (!localized) continue
    addNode({
      ...node,
      name: localized.value,
      metadata: {
        ...node.metadata,
        translationKey: key,
        language: localized.proof.sourcePath.toLowerCase().endsWith("/zh_cn.json") ? "zh_cn" : "en_us",
      },
      evidence: [localized.proof],
    })
  }

  const base = {
    schemaVersion: 1 as const,
    analysisVersion,
    projectId: catalog.projectId,
    catalogSha256: jsonDigest(catalog),
    generatedAt: new Date().toISOString(),
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    coverage: {
      selectedAssets: catalog.assets.length,
      inspectedClasses,
      availableClasses: classProvider?.paths.filter((name) => name.endsWith(".class")).length ?? 0,
      warnings: [...new Set([...catalog.warnings, ...warnings])],
    },
  }
  const graph = ImportAssetGraphSchema.parse({ ...base, graphSha256: jsonDigest(base) })
  return graph
}

/**
 * The mod's class files: the source JAR itself, or for a modpack the selected mod JARs inside it
 * (extracted to a temporary folder that `dispose` removes). Null when there is no code to read.
 */
export async function openImportClassProvider(input: { workspaceDirectory: string; id: string }) {
  const reader = await createImportedAssetReader(input),
    project = await getImportProject(input.workspaceDirectory, input.id),
    sourceJar = path.join(project.directory, "source", project.manifest.source.filename)
  let classProvider: GraphClassProvider | undefined, temporaryArchiveRoot: string | undefined
  const dispose = async () => {
    classProvider?.dispose?.()
    if (temporaryArchiveRoot) await rm(temporaryArchiveRoot, { recursive: true, force: true })
  }
  try {
    if (/\.jar$/i.test(project.manifest.source.filename))
      classProvider = await createJarClassProvider(sourceJar, project.manifest.source.sha256)
    else {
      const selected = reader.catalog.groups.filter((group) => group.kind === "mod" && group.path.endsWith(".jar"))
      if (selected.length) {
        if ((await hashFile(sourceJar)) !== project.manifest.source.sha256)
          throw new Error("Imported source archive checksum mismatch before class analysis")
        const cacheRoot = path.join(project.directory, ".cache", "import-asset-graph")
        await assertNoReverseSymlink(project.directory, ".cache/import-asset-graph", true)
        await mkdir(cacheRoot, { recursive: true })
        temporaryArchiveRoot = await mkdtemp(path.join(cacheRoot, "selected-"))
        const selectedPaths = new Set(selected.map((group) => group.path))
        await extractReverseArchive(sourceJar, temporaryArchiveRoot, {
          include: (entryPath) => selectedPaths.has(entryPath),
        })
        if ((await hashFile(sourceJar)) !== project.manifest.source.sha256)
          throw new Error("Imported source archive checksum mismatch after class extraction")
        const openedProviders = await Promise.allSettled(
          selected.map(async (group) => {
            const archivePath = group.path,
              archiveFilename = reverseFilePath(temporaryArchiveRoot!, archivePath)
            await assertNoReverseSymlink(temporaryArchiveRoot!, archivePath)
            const archiveInfo = await lstat(archiveFilename)
            if (!archiveInfo.isFile() || archiveInfo.size !== group.bytes)
              throw new Error(`Selected nested JAR size mismatch: ${archivePath}`)
            return { group, provider: await createJarClassProvider(archiveFilename) }
          }),
        )
        const failedProvider = openedProviders.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        )
        if (failedProvider) {
          openedProviders.forEach((result) => {
            if (result.status === "fulfilled") result.value.provider.dispose?.()
          })
          throw failedProvider.reason
        }
        const providers = openedProviders.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
        const owners = new Map<string, typeof providers>()
        providers.forEach((entry) =>
          entry.provider.paths.forEach((classPath) => owners.set(classPath, [...(owners.get(classPath) ?? []), entry])),
        )
        const ambiguous = [...owners].filter(([, entries]) => entries.length > 1).map(([classPath]) => classPath)
        classProvider = {
          sha256: sha256(
            Buffer.from(
              providers
                .map((entry) => entry.provider.sha256)
                .sort()
                .join("\n"),
            ),
          ),
          paths: [...owners].flatMap(([classPath, entries]) => (entries.length === 1 ? [classPath] : [])),
          sourcePathFor: (name) => {
            const entries = owners.get(name)
            if (!entries || entries.length !== 1)
              throw new Error(`Selected archive class is missing or ambiguous: ${name}`)
            return `${entries[0]!.group.path}!/${name}`
          },
          readFile: async (name) => {
            const entries = owners.get(name)
            if (!entries || entries.length !== 1)
              throw new Error(`Selected archive class is missing or ambiguous: ${name}`)
            return entries[0]!.provider.readFile(name)
          },
          verify: async () =>
            (await Promise.all(providers.map((entry) => entry.provider.verify?.() ?? Promise.resolve(false)))).every(
              Boolean,
            ),
          dispose: () => providers.forEach((entry) => entry.provider.dispose?.()),
          warnings: ambiguous.length
            ? [`所选嵌套模组中有 ${ambiguous.length} 个同名 class，已跳过以避免跨 JAR 混合关系。`]
            : [],
        }
      }
    }
  } catch (error) {
    await dispose()
    throw error
  }
  return { reader, provider: classProvider ?? null, dispose }
}

export async function buildImportAssetGraph(input: { workspaceDirectory: string; id: string }) {
  const root = await getImportAssetRoot(input),
    { reader, provider, dispose } = await openImportClassProvider(input),
    classProvider = provider ?? undefined
  try {
    const graph = await buildGraph({ catalog: reader.catalog, readBytes: reader.readBytes, classProvider }),
      destination = graphFile(root),
      temporary = `${destination}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(graph, null, 2)}\n`, { flag: "wx", mode: 0o600 })
    await rename(temporary, destination).catch(async (error) => {
      await rm(temporary, { force: true })
      throw error
    })
    return graph
  } finally {
    await dispose()
  }
}

export async function loadImportAssetGraph(input: { workspaceDirectory: string; id: string }) {
  const [reader, root] = await Promise.all([createImportedAssetReader(input), getImportAssetRoot(input)]),
    catalog = reader.catalog
  const filename = graphFile(root),
    info = await lstat(filename).catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? undefined : Promise.reject(error),
    )
  if (!info) return buildImportAssetGraph(input)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024)
    throw new Error("Imported asset graph is unsafe or too large")
  const stored = JSON.parse(await readFile(filename, "utf8")) as { analysisVersion?: unknown }
  if (stored.analysisVersion !== analysisVersion) return buildImportAssetGraph(input)
  const graph = ImportAssetGraphSchema.parse(stored),
    { graphSha256, ...content } = graph
  if (graph.projectId !== catalog.projectId) throw new Error("Imported asset graph project mismatch")
  if (graph.catalogSha256 !== jsonDigest(catalog)) return buildImportAssetGraph(input)
  if (graphSha256 !== jsonDigest(content))
    throw new Error("Imported asset graph checksum mismatch; possible tampering detected")
  return graph
}

import { expect, test } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { buildImportAssetGraph } from "@minemods/mod-core/import-asset-graph"
import {
  extractImportAssets,
  getImportedAssetCatalog,
  getImportAssetSelection,
  saveImportedAssetFile,
} from "@minemods/mod-core/import-assets"
import { importProject } from "@minemods/mod-core/import-project"
import {
  GraphAnalysisResultSchema,
  IMPORT_ASSET_GRAPH_INSTRUCTIONS,
  prepareImportAssetGraphAnalysis,
  validateImportAssetGraphAnalysis,
} from "../src/main/import-asset-graph-ai"
import { requestAuthoring } from "../src/main/authoring-ai"
import { createImportAssetGraphService } from "../src/main/import-asset-graph-service"
import { startChatOnlyProvider } from "./fixtures/chat-only-provider"

const { zipSync } = createRequire(path.join(import.meta.dir, "../../mod-core/package.json"))("fflate") as {
  zipSync: (files: Record<string, Uint8Array>) => Uint8Array
}
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")
const projectId = "20000000-0000-4000-8000-000000000001"
const evidence = (sourcePath: string, summary: string) => ({
  sourcePath,
  sourceAssetId: null,
  sha256: sha256(sourcePath),
  method: "json" as const,
  instruction: null,
  jsonPointer: "/textures/all",
  summary,
})

const graphFixture = () => {
  const model = {
    id: "node_model",
    kind: "model" as const,
    name: "crystal",
    resourceId: "sample:block/crystal",
    sourceAssetId: null,
    sourcePath: "assets/sample/models/block/crystal.json",
    metadata: {},
    evidence: [evidence("assets/sample/models/block/crystal.json", "模型 JSON 引用 all 纹理。")],
  }
  const texture = {
    id: "node_texture",
    kind: "texture" as const,
    name: "crystal",
    resourceId: "sample:block/crystal",
    sourceAssetId: null,
    sourcePath: "assets/sample/textures/block/crystal.png",
    metadata: {},
    evidence: [evidence("assets/sample/textures/block/crystal.png", "目录中存在该 PNG。")],
  }
  const animation = {
    id: "node_animation",
    kind: "animation" as const,
    name: "crystal_idle",
    resourceId: "sample:crystal_idle",
    sourceAssetId: null,
    sourcePath: "assets/sample/animations/crystal.json",
    metadata: {},
    evidence: [evidence("assets/sample/animations/crystal.json", "存在动画资源。")],
  }
  return {
    analysisVersion: 2 as const,
    schemaVersion: 1 as const,
    projectId,
    catalogSha256: sha256("catalog"),
    generatedAt: new Date().toISOString(),
    nodes: [model, texture, animation],
    edges: [
      {
        id: "edge_model_texture",
        from: model.id,
        to: texture.id,
        type: "uses_texture" as const,
        relationStatus: "verified" as const,
        evidence: [evidence(model.sourcePath!, "JSON 明确引用了该贴图。")],
      },
      {
        id: "edge_model_animation",
        from: model.id,
        to: animation.id,
        type: "has_animation" as const,
        relationStatus: "candidate" as const,
        evidence: [evidence(animation.sourcePath!, "同一命名空间内发现同名动画，关系待确认。")],
      },
    ],
    coverage: { selectedAssets: 3, inspectedClasses: 0, availableClasses: 0, warnings: [] },
    graphSha256: sha256("graph"),
  }
}

test("中文证据上下文按 UTF-8 字节限制预算", () => {
  const graph = graphFixture()
  graph.nodes[0]!.evidence = Array.from({ length: 50 }, (_, index) =>
    evidence(`source-${index}.json`, "证".repeat(1000)),
  )
  expect(() => prepareImportAssetGraphAnalysis(graph, [graph.nodes[0]!.id])).toThrow(/GRAPH_ANALYSIS_CONTEXT_TOO_LARGE/)
})

const relationshipGraphFixture = () => {
  const graph = graphFixture()
  const entity = {
    id: "node_entity",
    kind: "entity" as const,
    name: "crystal_golem",
    resourceId: "sample:crystal_golem",
    sourceAssetId: null,
    sourcePath: "assets/sample/entity/crystal_golem.json",
    metadata: {},
    evidence: [evidence("assets/sample/entity/crystal_golem.json", "实体注册 JSON。")],
  }
  const entityClass = {
    id: "node_entity_class",
    kind: "class" as const,
    name: "CrystalGolemEntity",
    resourceId: null,
    sourceAssetId: null,
    sourcePath: "sample/CrystalGolemEntity.class",
    metadata: {},
    evidence: [evidence("sample/CrystalGolemEntity.class", "实体注册类。")],
  }
  const unrelated = {
    id: "node_unrelated_audio",
    kind: "audio" as const,
    name: "ambient",
    resourceId: "sample:ambient",
    sourceAssetId: null,
    sourcePath: "assets/sample/sounds/ambient.ogg",
    metadata: {},
    evidence: [evidence("assets/sample/sounds/ambient.ogg", "无关音频。")],
  }
  const biome = {
    id: "node_biome",
    kind: "biome" as const,
    name: "crystal_caves",
    resourceId: "sample:crystal_caves",
    sourceAssetId: null,
    sourcePath: "sample/CrystalCaves.class",
    metadata: {},
    evidence: [evidence("sample/CrystalCaves.class", "生物群系信息。")],
  }
  return {
    ...graph,
    nodes: [entity, entityClass, biome, ...graph.nodes, unrelated],
    edges: [
      {
        id: "edge_biome_entity",
        from: "node_biome",
        to: entity.id,
        type: "spawns_in" as const,
        relationStatus: "verified" as const,
        evidence: [evidence("sample/biome.class", "生物群系注册实体。")],
      },
      {
        id: "edge_entity_class",
        from: entity.id,
        to: entityClass.id,
        type: "references" as const,
        relationStatus: "verified" as const,
        evidence: [evidence(entity.sourcePath!, "实体注册指向实现类。")],
      },
      {
        id: "edge_class_model",
        from: entityClass.id,
        to: "node_model",
        type: "uses_model" as const,
        relationStatus: "verified" as const,
        evidence: [evidence(entityClass.sourcePath!, "类字节码引用模型。")],
      },
      ...graph.edges,
    ],
  }
}

test("资产图上下文包含 verified 四层闭包与所选节点的直接 incoming 关系", () => {
  const graph = graphFixture()
  const first = prepareImportAssetGraphAnalysis(graph, ["node_model"])
  const second = prepareImportAssetGraphAnalysis(graph, ["node_model"])
  expect(first.context.contextId).not.toBe(second.context.contextId)
  expect(first.context.evidenceRefs.map((item) => item.id)).toEqual(second.context.evidenceRefs.map((item) => item.id))
  expect(first.context.selectedNodeIds).toEqual(["node_model"])
  expect(first.context.nodes.map((node) => node.id).sort()).toEqual(["node_animation", "node_model", "node_texture"])
  expect(first.context.edges.map((edge) => edge.relationStatus)).toEqual(["verified", "candidate"])
  expect(first.context.evidenceRefs.every((item) => /^evidence_[a-f0-9]{64}$/.test(item.id))).toBe(true)
  expect(first.structured_prompt.relation_rules.some((rule) => rule.includes("candidate"))).toBe(true)
  expect(first.response_schema).toBeTruthy()
  expect(() => prepareImportAssetGraphAnalysis(graph, ["not-in-graph"])).toThrow("GRAPH_ANALYSIS_NODE_NOT_FOUND")
})

test("所选实体可引用 verified 下游贴图证据，但 candidate 路径与无关节点不可冒充事实", () => {
  const prepared = prepareImportAssetGraphAnalysis(relationshipGraphFixture(), ["node_entity"])
  expect(prepared.context.nodes.map((node) => node.id)).toContain("node_texture")
  expect(prepared.context.nodes.map((node) => node.id)).toContain("node_biome")
  expect(prepared.context.nodes.map((node) => node.id)).not.toContain("node_unrelated_audio")
  const textureEvidence = prepared.context.evidenceRefs.find((item) => item.nodeIds.includes("node_texture"))!
  const valid = {
    schemaVersion: 1 as const,
    projectId,
    contextId: prepared.context.contextId,
    catalogSha256: prepared.context.catalogSha256,
    entries: [
      {
        nodeId: "node_entity",
        summary: "实体关系链指向该贴图。",
        evidenceIds: [textureEvidence.id],
        facts: [{ text: "模型图节点关联这张贴图。", evidenceIds: [textureEvidence.id] }],
        unknowns: [],
        relatedEdgeIds: ["edge_entity_class", "edge_class_model", "edge_model_texture"],
      },
    ],
    unknowns: [],
  }
  expect(validateImportAssetGraphAnalysis(prepared.context, valid)).toEqual(valid)
  const candidateEvidence = prepared.context.evidenceRefs.find((item) => item.edgeIds.includes("edge_model_animation"))!
  expect(() =>
    validateImportAssetGraphAnalysis(prepared.context, {
      ...valid,
      entries: [{ ...valid.entries[0]!, evidenceIds: [candidateEvidence.id] }],
    }),
  ).toThrow("GRAPH_ANALYSIS_EVIDENCE_REFERENCE_INVALID")
  const unrelatedEvidence = evidence("assets/sample/sounds/ambient.ogg", "无关音频。")
  const unrelatedId = `evidence_${sha256(
    JSON.stringify([
      unrelatedEvidence.sourcePath,
      unrelatedEvidence.sourceAssetId,
      unrelatedEvidence.sha256,
      unrelatedEvidence.method,
      unrelatedEvidence.instruction,
      unrelatedEvidence.jsonPointer,
      unrelatedEvidence.summary,
    ]),
  )}`
  expect(() =>
    validateImportAssetGraphAnalysis(prepared.context, {
      ...valid,
      entries: [{ ...valid.entries[0]!, evidenceIds: [unrelatedId] }],
    }),
  ).toThrow("GRAPH_ANALYSIS_EVIDENCE_REFERENCE_INVALID")
})

test("闭包外 candidate 关系残留在可达目标节点时仍不能作为事实证据", () => {
  const base = relationshipGraphFixture()
  const candidateProof = evidence("assets/sample/models/outside.json", "闭包外来源声明了候选贴图关系。")
  const graph = {
    ...base,
    nodes: [
      ...base.nodes.map((node) =>
        node.id === "node_texture" ? { ...node, evidence: [...node.evidence, candidateProof] } : node,
      ),
      {
        id: "node_outside_source",
        kind: "model" as const,
        name: "outside",
        resourceId: "sample:block/outside",
        sourceAssetId: null,
        sourcePath: candidateProof.sourcePath,
        metadata: {},
        evidence: [candidateProof],
      },
    ],
    edges: [
      ...base.edges,
      {
        id: "edge_external_candidate",
        from: "node_outside_source",
        to: "node_texture",
        type: "uses_texture" as const,
        relationStatus: "candidate" as const,
        evidence: [candidateProof],
      },
    ],
  }
  const prepared = prepareImportAssetGraphAnalysis(graph, ["node_entity"])
  expect(prepared.context.nodes.map((node) => node.id)).toContain("node_texture")
  expect(prepared.context.edges.map((edge) => edge.id)).not.toContain("edge_external_candidate")
  expect(prepared.context.evidenceRefs.some((item) => item.sourcePath === candidateProof.sourcePath)).toBe(false)

  const candidateId = `evidence_${sha256(
    JSON.stringify([
      candidateProof.sourcePath,
      candidateProof.sourceAssetId,
      candidateProof.sha256,
      candidateProof.method,
      candidateProof.instruction,
      candidateProof.jsonPointer,
      candidateProof.summary,
    ]),
  )}`
  expect(() =>
    validateImportAssetGraphAnalysis(prepared.context, {
      schemaVersion: 1,
      projectId,
      contextId: prepared.context.contextId,
      catalogSha256: prepared.context.catalogSha256,
      entries: [
        {
          nodeId: "node_entity",
          summary: "实体指向了候选贴图关系。",
          evidenceIds: [candidateId],
          facts: [{ text: "闭包外模型引用该贴图。", evidenceIds: [candidateId] }],
          unknowns: [],
          relatedEdgeIds: ["edge_entity_class", "edge_class_model", "edge_model_texture"],
        },
      ],
      unknowns: [],
    }),
  ).toThrow("GRAPH_ANALYSIS_EVIDENCE_REFERENCE_INVALID")

  const selectedVerifiedEvidence = prepared.context.evidenceRefs.find((item) =>
    item.edgeIds.includes("edge_model_texture"),
  )!
  const valid = {
    schemaVersion: 1 as const,
    projectId,
    contextId: prepared.context.contextId,
    catalogSha256: prepared.context.catalogSha256,
    entries: [
      {
        nodeId: "node_entity",
        summary: "实体关系链指向该贴图。",
        evidenceIds: [selectedVerifiedEvidence.id],
        facts: [{ text: "模型节点通过 verified 关系引用贴图。", evidenceIds: [selectedVerifiedEvidence.id] }],
        unknowns: [],
        relatedEdgeIds: ["edge_entity_class", "edge_class_model", "edge_model_texture"],
      },
    ],
    unknowns: [],
  }
  expect(validateImportAssetGraphAnalysis(prepared.context, valid)).toEqual(valid)
})

test("资产图解释要求每个已选节点都有本地证据，并只接受已有 verified 边", () => {
  const prepared = prepareImportAssetGraphAnalysis(graphFixture(), ["node_model"])
  const modelEvidence = prepared.context.evidenceRefs.find((item) => item.nodeIds.includes("node_model"))!.id
  const verifiedEdge = prepared.context.edges.find((edge) => edge.relationStatus === "verified")!
  const valid = {
    schemaVersion: 1 as const,
    projectId: projectId,
    contextId: prepared.context.contextId,
    catalogSha256: prepared.context.catalogSha256,
    entries: [
      {
        nodeId: "node_model",
        summary: "模型资源明确引用了一个贴图。",
        evidenceIds: [modelEvidence],
        facts: [{ text: "模型 JSON 包含纹理引用。", evidenceIds: [modelEvidence] }],
        unknowns: ["目前没有证据说明该资源在游戏运行时的表现。"],
        relatedEdgeIds: [verifiedEdge.id],
      },
    ],
    unknowns: [],
  }
  expect(validateImportAssetGraphAnalysis(prepared.context, valid)).toEqual(valid)
  expect(() =>
    validateImportAssetGraphAnalysis(prepared.context, {
      ...valid,
      entries: [{ ...valid.entries[0]!, relatedEdgeIds: ["edge_fabricated"] }],
    }),
  ).toThrow("GRAPH_ANALYSIS_EDGE_REFERENCE_INVALID")
  const candidateEdge = prepared.context.edges.find((edge) => edge.relationStatus === "candidate")!
  expect(() =>
    validateImportAssetGraphAnalysis(prepared.context, {
      ...valid,
      entries: [{ ...valid.entries[0]!, relatedEdgeIds: [candidateEdge.id] }],
    }),
  ).toThrow("GRAPH_ANALYSIS_EDGE_REFERENCE_INVALID")
  const candidateEvidence = prepared.context.evidenceRefs.find((item) => item.edgeIds.includes(candidateEdge.id))!
  expect(() =>
    validateImportAssetGraphAnalysis(prepared.context, {
      ...valid,
      entries: [{ ...valid.entries[0]!, evidenceIds: [candidateEvidence.id] }],
    }),
  ).toThrow("GRAPH_ANALYSIS_EVIDENCE_REFERENCE_INVALID")
  const conflictingGraph = graphFixture()
  const modelNode = conflictingGraph.nodes.find((node) => node.id === "node_model")!
  conflictingGraph.edges.find((edge) => edge.relationStatus === "candidate")!.evidence = [modelNode.evidence[0]!]
  const conflictingContext = prepareImportAssetGraphAnalysis(conflictingGraph, ["node_model"]).context
  const candidateOnlyEvidence = conflictingContext.evidenceRefs.find((item) =>
    item.edgeIds.some((edgeId) =>
      conflictingContext.edges.some((edge) => edge.id === edgeId && edge.relationStatus === "candidate"),
    ),
  )!
  expect(candidateOnlyEvidence.nodeIds).not.toContain("node_model")
  expect(() =>
    validateImportAssetGraphAnalysis(conflictingContext, {
      ...valid,
      contextId: conflictingContext.contextId,
      catalogSha256: conflictingContext.catalogSha256,
      entries: [{ ...valid.entries[0]!, evidenceIds: [candidateOnlyEvidence.id] }],
    }),
  ).toThrow("GRAPH_ANALYSIS_EVIDENCE_REFERENCE_INVALID")
  const unrelatedEvidence = prepared.context.evidenceRefs.find((item) => item.nodeIds.includes("node_animation"))!
  expect(() =>
    validateImportAssetGraphAnalysis(prepared.context, {
      ...valid,
      entries: [{ ...valid.entries[0]!, evidenceIds: [unrelatedEvidence.id] }],
    }),
  ).toThrow("GRAPH_ANALYSIS_EVIDENCE_REFERENCE_INVALID")
  expect(() =>
    validateImportAssetGraphAnalysis(prepared.context, {
      ...valid,
      contextId: sha256("another snapshot"),
    }),
  ).toThrow("GRAPH_ANALYSIS_CONTEXT_MISMATCH")
  expect(() => validateImportAssetGraphAnalysis(prepared.context, { ...valid, entries: [] })).toThrow()
})

test("MCP 图解读保存 awaiting_model 快照，外部提交复核时检查当前图指纹", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-asset-graph-ai-"))
  const workspaceDirectory = path.join(root, "workspace")
  await mkdir(workspaceDirectory, { recursive: true })
  const source = path.join(root, "sample.zip")
  const modJar = zipSync({
    "fabric.mod.json": Buffer.from(
      JSON.stringify({ schemaVersion: 1, id: "sample", version: "1.0.0", name: "Sample" }),
    ),
    "assets/sample/models/block/crystal.json": Buffer.from(
      JSON.stringify({
        textures: { all: "sample:block/crystal" },
        elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: {} }],
      }),
    ),
    "assets/sample/textures/block/crystal.png": Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64",
    ),
  })
  await writeFile(source, zipSync({ "overrides/mods/sample.jar": modJar }))
  const imported = await importProject({ workspaceDirectory, filename: source })
  const selection = await getImportAssetSelection({ workspaceDirectory, id: imported.manifest.id })
  const mod = selection.groups.find((group) => group.kind === "mod")!
  await extractImportAssets({ workspaceDirectory, id: imported.manifest.id, groupIds: [mod.id] })
  const graph = await buildImportAssetGraph({ workspaceDirectory, id: imported.manifest.id })
  const model = graph.nodes.find((node) => node.kind === "model")!
  const service = createImportAssetGraphService({
    workspaceDirectory,
    connection: () => ({ mode: "mcp" }),
    publicError: (error) => (error instanceof Error ? error.message : "unknown"),
  })
  try {
    const pendingStart = service.start({ id: imported.manifest.id, nodeIds: [model.id] })
    await expect(service.start({ id: imported.manifest.id, nodeIds: [model.id] })).rejects.toThrow("正在启动或运行")
    const run = await pendingStart
    expect(run.state).toBe("awaiting_model")
    expect(run.context.projectId).toBe(imported.manifest.id)
    expect(run.contextId).toBe(run.context.contextId)
    const persisted = JSON.parse(
      await readFile(
        path.join(
          workspaceDirectory,
          "analysis-projects",
          imported.manifest.id,
          "asset-workspace",
          "graph-analysis.json",
        ),
        "utf8",
      ),
    )
    expect(persisted.state).toBe("awaiting_model")
    const evidenceId = run.context.evidenceRefs.find((item) => item.nodeIds.includes(model.id))!.id
    const result = {
      schemaVersion: 1 as const,
      projectId: run.projectId,
      contextId: run.contextId,
      catalogSha256: run.catalogSha256,
      entries: [
        {
          nodeId: model.id,
          summary: "静态模型说明。",
          evidenceIds: [evidenceId],
          facts: [],
          unknowns: [],
          relatedEdgeIds: [],
        },
      ],
      unknowns: [],
    }
    const stateFile = path.join(
      workspaceDirectory,
      "analysis-projects",
      imported.manifest.id,
      "asset-workspace",
      "graph-analysis.json",
    )
    const awaitingRecord = await readFile(stateFile, "utf8")
    const mismatchedState = JSON.parse(awaitingRecord)
    mismatchedState.result = result
    await writeFile(stateFile, JSON.stringify(mismatchedState))
    await expect(service.get({ id: imported.manifest.id })).rejects.toThrow("GRAPH_ANALYSIS_RESULT_STATE_MISMATCH")
    await writeFile(stateFile, awaitingRecord)
    await expect(service.submit({ id: imported.manifest.id, contextId: randomUUID(), result })).rejects.toThrow(
      "图解读上下文已过期",
    )
    const [polled, completed] = await Promise.all([
      service.get({ id: imported.manifest.id }),
      service.submit({ id: imported.manifest.id, contextId: run.contextId, result }),
    ])
    expect(["awaiting_model", "review"].includes(polled?.state ?? "")).toBe(true)
    expect(completed.state).toBe("review")
    expect((await service.get({ id: imported.manifest.id }))?.result).toEqual(result)
    const validRecord = await readFile(stateFile, "utf8")
    const invalidResult = JSON.parse(validRecord)
    invalidResult.result.entries[0].relatedEdgeIds = ["edge_fabricated"]
    await writeFile(stateFile, JSON.stringify(invalidResult))
    await expect(service.get({ id: imported.manifest.id })).rejects.toThrow("GRAPH_ANALYSIS_REVIEW_RESULT_INVALID")
    await writeFile(stateFile, validRecord)
    await expect(service.validateForExport({ id: imported.manifest.id })).resolves.toMatchObject({ state: "review" })
    const cancellable = await service.start({ id: imported.manifest.id, nodeIds: [model.id] })
    const canceling = service.cancel({ id: imported.manifest.id })
    await expect(
      service.submit({
        id: imported.manifest.id,
        contextId: cancellable.contextId,
        result: { ...result, contextId: cancellable.contextId },
      }),
    ).rejects.toThrow()
    expect((await canceling)?.state).toBe("canceled")
    const apiService = createImportAssetGraphService({
      workspaceDirectory,
      connection: () => ({ mode: "api", apiKey: "fixture-key" }),
      publicError: (error) => (error instanceof Error ? error.message : "unknown"),
    })
    const starts = await Promise.allSettled(Array.from({ length: 3 }, () => apiService.start({ id: randomUUID() })))
    expect(starts[2]?.status).toBe("rejected")
    if (starts[2]?.status === "rejected") expect(String(starts[2].reason)).toContain("已有两个 AI 任务")
    await apiService.dispose()
    expect(apiService.isBusy()).toBe(false)
    const stale = await service.start({ id: imported.manifest.id, nodeIds: [model.id] })
    const catalog = (await getImportedAssetCatalog({ workspaceDirectory, id: imported.manifest.id }))!
    const modelAsset = catalog.assets.find((asset) => asset.kind === "model")!
    await saveImportedAssetFile({
      workspaceDirectory,
      id: imported.manifest.id,
      assetId: modelAsset.id,
      expectedSha256: modelAsset.sha256,
      content: JSON.stringify({ textures: { all: "sample:block/crystal" }, elements: [] }),
    })
    expect((await service.get({ id: imported.manifest.id }))?.state).toBe("stale")
    await expect(service.validateForExport({ id: imported.manifest.id })).resolves.toMatchObject({
      state: "stale",
      result: null,
    })
    await expect(service.submit({ id: imported.manifest.id, contextId: stale.contextId, result })).rejects.toThrow(
      "当前图解读任务不在等待结果的状态",
    )
    await expect(service.submit({ id: imported.manifest.id, contextId: run.contextId, result })).rejects.toThrow(
      "当前图解读任务不在等待结果的状态",
    )
    const assetRoot = path.join(workspaceDirectory, "analysis-projects", imported.manifest.id, "asset-workspace")
    const tampered = JSON.parse(await readFile(stateFile, "utf8"))
    tampered.context.evidenceRefs[0].summary = "tampered evidence"
    await writeFile(stateFile, JSON.stringify(tampered))
    await expect(service.get({ id: imported.manifest.id })).rejects.toThrow("GRAPH_ANALYSIS_CONTEXT_ID_MISMATCH")
  } finally {
    await service.dispose()
    if (path.resolve(path.dirname(root)) !== path.resolve(os.tmpdir())) throw new Error("Unexpected cleanup path")
    await rm(root, { recursive: true, force: true })
  }
})

test("资产图解读可通过仅支持 Chat Completions 的服务和自定义模型完成", async () => {
  const prepared = prepareImportAssetGraphAnalysis(graphFixture(), ["node_model"])
  const modelEvidence = prepared.context.evidenceRefs.find((item) => item.nodeIds.includes("node_model"))!.id
  const valid = {
    schemaVersion: 1 as const,
    projectId,
    contextId: prepared.context.contextId,
    catalogSha256: prepared.context.catalogSha256,
    entries: [
      {
        nodeId: "node_model",
        summary: "模型资源明确引用了一个贴图。",
        evidenceIds: [modelEvidence],
        facts: [{ text: "模型 JSON 包含纹理引用。", evidenceIds: [modelEvidence] }],
        unknowns: [],
        relatedEdgeIds: [prepared.context.edges.find((edge) => edge.relationStatus === "verified")!.id],
      },
    ],
    unknowns: [],
  }
  const provider = await startChatOnlyProvider(() => valid)
  try {
    // Same request the asset graph service issues for API mode.
    const result = await requestAuthoring(GraphAnalysisResultSchema, prepared.context, {
      apiKey: "fixture-key",
      baseUrl: provider.baseUrl,
      model: "glm-4-plus",
      instructions: IMPORT_ASSET_GRAPH_INSTRUCTIONS,
      signal: new AbortController().signal,
    })
    expect(validateImportAssetGraphAnalysis(prepared.context, result)).toEqual(valid)
    const last = provider.calls.at(-1)!
    expect(last.path).toBe("/v1/chat/completions")
    expect(last.body.model).toBe("glm-4-plus")
    expect(last.body.messages[0].content).toStartWith(IMPORT_ASSET_GRAPH_INSTRUCTIONS)
    expect(last.body.messages[0].content).toContain('"contextId"')
  } finally {
    provider.close()
  }
})

import { randomUUID } from "node:crypto"
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { getImportAssetRoot } from "@minemods/mod-core/import-assets"
import { loadImportAssetGraph } from "@minemods/mod-core/import-asset-graph"
import { requestAuthoring } from "./authoring-ai"
import {
  GraphAnalysisContextSchema,
  GraphAnalysisResultSchema,
  IMPORT_ASSET_GRAPH_INSTRUCTIONS,
  prepareImportAssetGraphAnalysis,
  validateImportAssetGraphAnalysis,
} from "./import-asset-graph-ai"

const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
export const ImportAssetGraphAnalysisRunSchema = z
  .strictObject({
    id: z.uuid(),
    projectId: z.uuid(),
    contextId: sha256,
    catalogSha256: sha256,
    graphSha256: sha256,
    selectedNodeIds: z.array(z.string().min(1).max(128)).min(1).max(80),
    state: z.enum(["awaiting_model", "running", "review", "failed", "canceled", "stale"]),
    context: GraphAnalysisContextSchema,
    result: GraphAnalysisResultSchema.nullable(),
    error: z.string().max(4000).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((run, issue) => {
    if (
      run.context.projectId !== run.projectId ||
      run.context.contextId !== run.contextId ||
      run.context.catalogSha256 !== run.catalogSha256 ||
      run.context.graphSha256 !== run.graphSha256 ||
      JSON.stringify(run.context.selectedNodeIds) !== JSON.stringify(run.selectedNodeIds)
    )
      issue.addIssue({ code: "custom", message: "GRAPH_ANALYSIS_RUN_CONTEXT_MISMATCH" })
    if (run.state === "review" && !run.result)
      issue.addIssue({ code: "custom", message: "GRAPH_ANALYSIS_REVIEW_RESULT_MISSING" })
    if (run.state !== "review" && run.result !== null)
      issue.addIssue({ code: "custom", message: "GRAPH_ANALYSIS_RESULT_STATE_MISMATCH" })
    if (run.state === "review" && run.result) {
      try {
        validateImportAssetGraphAnalysis(run.context, run.result)
      } catch {
        issue.addIssue({ code: "custom", path: ["result"], message: "GRAPH_ANALYSIS_REVIEW_RESULT_INVALID" })
      }
    }
  })
export type ImportAssetGraphAnalysisRun = z.infer<typeof ImportAssetGraphAnalysisRunSchema>
export class ImportAssetGraphAnalysisError extends Error {}

export function createImportAssetGraphService(options: {
  workspaceDirectory: string
  connection: () => { mode?: string; apiKey?: string; baseUrl?: string; model?: string }
  publicError: (error: unknown) => string
}) {
  const active = new Map<string, { controller: AbortController; work: Promise<void> }>()
  const starting = new Set<string>()
  const aiStarting = new Set<string>()
  const cancelRequested = new Set<string>()
  const tails = new Map<string, Promise<unknown>>()
  const filename = "graph-analysis.json"
  const filePath = async (id: string) =>
    path.join(await getImportAssetRoot({ workspaceDirectory: options.workspaceDirectory, id }), filename)
  const write = async (runInput: unknown) => {
    const run = ImportAssetGraphAnalysisRunSchema.parse(runInput)
    const target = await filePath(run.projectId)
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(run)}\n`, { flag: "wx", mode: 0o600 })
    await rename(temporary, target).catch(async (error) => {
      await rm(temporary, { force: true })
      throw error
    })
    return run
  }
  const read = async (id: string) => {
    const target = await filePath(id)
    const info = await lstat(target).catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? undefined : Promise.reject(error),
    )
    if (!info) return null
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2_000_000)
      throw new ImportAssetGraphAnalysisError("资产图 AI 分析记录不可用或过大。")
    const run = ImportAssetGraphAnalysisRunSchema.parse(JSON.parse(await readFile(target, "utf8")))
    if (run.projectId !== id) throw new ImportAssetGraphAnalysisError("资产图分析记录与工程不匹配。")
    return run
  }
  const exclusive = async <T>(id: string, operation: () => Promise<T>) => {
    const previous = tails.get(id) ?? Promise.resolve()
    const pending = previous.catch(() => undefined).then(operation)
    tails.set(id, pending)
    return pending.finally(() => {
      if (tails.get(id) === pending) tails.delete(id)
    })
  }
  const currentGraph = (id: string) => loadImportAssetGraph({ workspaceDirectory: options.workspaceDirectory, id })
  const matchesCurrentContext = (run: ImportAssetGraphAnalysisRun, graph: Awaited<ReturnType<typeof currentGraph>>) => {
    const expected = prepareImportAssetGraphAnalysis(graph, run.selectedNodeIds, run.context.requestId).context
    return expected.contextId === run.contextId && JSON.stringify(expected) === JSON.stringify(run.context)
  }
  const get = async (input: { id: string }) =>
    exclusive(input.id, async () => {
      const run = await read(input.id)
      if (!run || run.state === "stale") return run
      if (run.state === "running" && !active.has(input.id))
        return write({
          ...run,
          state: "failed",
          error: "上次图解读因应用退出而中断，请重新开始。",
          updatedAt: new Date().toISOString(),
        })
      if (run.state === "review" && run.result) validateImportAssetGraphAnalysis(run.context, run.result)
      const graph = await currentGraph(input.id)
      if (graph.catalogSha256 === run.catalogSha256 && graph.graphSha256 === run.graphSha256) {
        if (!matchesCurrentContext(run, graph))
          throw new ImportAssetGraphAnalysisError("GRAPH_ANALYSIS_SNAPSHOT_TAMPERED:保存的上下文与当前资产图不一致。")
        return run
      }
      return write({
        ...run,
        state: "stale",
        result: null,
        error: "资产目录或静态关系图已变化，请重新解读。",
        updatedAt: new Date().toISOString(),
      })
    })
  const validateForExport = async (input: { id: string }) =>
    exclusive(input.id, async () => {
      const run = await read(input.id)
      if (!run) return null
      const graph = await currentGraph(input.id)
      if (graph.catalogSha256 !== run.catalogSha256 || graph.graphSha256 !== run.graphSha256)
        return write({
          ...run,
          state: "stale",
          result: null,
          error: "资产目录或关系图已变化；已保留历史上下文，当前结果已清除。",
          updatedAt: new Date().toISOString(),
        })
      if (!matchesCurrentContext(run, graph))
        throw new ImportAssetGraphAnalysisError("GRAPH_ANALYSIS_SNAPSHOT_TAMPERED:保存的上下文与当前资产图不一致。")
      if (run.state === "review" && run.result) validateImportAssetGraphAnalysis(run.context, run.result)
      return run
    })
  const prepare = async (input: { id: string; nodeIds?: string[] }) => {
    const graph = await currentGraph(input.id)
    return prepareImportAssetGraphAnalysis(graph, input.nodeIds)
  }
  const submit = async (input: { id: string; contextId: string; result: unknown }) =>
    exclusive(input.id, async () => {
      const run = await read(input.id)
      if (!run || !["awaiting_model", "running"].includes(run.state))
        throw new ImportAssetGraphAnalysisError("当前图解读任务不在等待结果的状态。")
      if (cancelRequested.has(input.id)) throw new ImportAssetGraphAnalysisError("图解读任务正在取消，结果已丢弃。")
      if (run.contextId !== input.contextId)
        throw new ImportAssetGraphAnalysisError("图解读上下文已过期，请领取最新任务。")
      const graph = await currentGraph(input.id)
      if (graph.catalogSha256 !== run.catalogSha256 || graph.graphSha256 !== run.graphSha256)
        return write({
          ...run,
          state: "stale",
          result: null,
          error: "资产目录或关系图已变化，结果已丢弃。",
          updatedAt: new Date().toISOString(),
        })
      if (!matchesCurrentContext(run, graph))
        throw new ImportAssetGraphAnalysisError("GRAPH_ANALYSIS_SNAPSHOT_TAMPERED:保存的上下文与当前资产图不一致。")
      if (cancelRequested.has(input.id)) throw new ImportAssetGraphAnalysisError("图解读任务正在取消，结果已丢弃。")
      const result = validateImportAssetGraphAnalysis(run.context, input.result)
      return write({ ...run, state: "review", result, error: null, updatedAt: new Date().toISOString() })
    })
  const start = async (input: { id: string; nodeIds?: string[] }) => {
    if (starting.has(input.id) || active.has(input.id))
      throw new ImportAssetGraphAnalysisError("此工程已有一个图解读任务正在启动或运行，请稍后再试。")
    if (cancelRequested.has(input.id)) throw new ImportAssetGraphAnalysisError("此工程的图解读正在取消，请稍后再试。")
    const connection = options.connection()
    const external = connection.mode === "mcp"
    if (!external && !connection.apiKey?.trim())
      throw new ImportAssetGraphAnalysisError("请在设置中连接 AI，或切换到 MCP 模式后由外部模型领取资产图解读任务。")
    if (!external && active.size + aiStarting.size >= 2)
      throw new ImportAssetGraphAnalysisError("已有两个 AI 任务正在运行，请稍后再试。")
    starting.add(input.id)
    if (!external) aiStarting.add(input.id)
    try {
      return await startTask(input, connection, external)
    } finally {
      starting.delete(input.id)
      aiStarting.delete(input.id)
    }
  }
  const startTask = async (
    input: { id: string; nodeIds?: string[] },
    connection: ReturnType<typeof options.connection>,
    external: boolean,
  ) => {
    const prepared = await prepare(input)
    if (cancelRequested.has(input.id)) throw new ImportAssetGraphAnalysisError("图解读任务正在取消，已停止启动。")
    const time = new Date().toISOString()
    const run = ImportAssetGraphAnalysisRunSchema.parse({
      id: randomUUID(),
      projectId: input.id,
      contextId: prepared.context.contextId,
      catalogSha256: prepared.context.catalogSha256,
      graphSha256: prepared.context.graphSha256,
      selectedNodeIds: prepared.context.selectedNodeIds,
      state: external ? "awaiting_model" : "running",
      context: prepared.context,
      result: null,
      error: null,
      createdAt: time,
      updatedAt: time,
    })
    await exclusive(input.id, () => write(run))
    if (external) return run
    const controller = new AbortController()
    const task = { controller, work: Promise.resolve() }
    active.set(input.id, task)
    task.work = Promise.resolve()
      .then(async () => {
        const result = await requestAuthoring(GraphAnalysisResultSchema, prepared.context, {
          apiKey: connection.apiKey!,
          baseUrl: connection.baseUrl,
          model: connection.model,
          instructions: IMPORT_ASSET_GRAPH_INSTRUCTIONS,
          signal: controller.signal,
        })
        const current = await read(input.id)
        if (current?.id !== run.id) return
        await submit({ id: input.id, contextId: prepared.context.contextId, result })
      })
      .catch(async (error: unknown) => {
        const current = await read(input.id).catch(() => null)
        if (!current || current.id !== run.id || current.state === "canceled" || current.state === "stale") return
        await exclusive(input.id, () =>
          write({
            ...current,
            state: controller.signal.aborted ? "canceled" : "failed",
            error: controller.signal.aborted ? null : options.publicError(error),
            updatedAt: new Date().toISOString(),
          }),
        ).catch(() => undefined)
      })
      .finally(() => {
        if (active.get(input.id) === task) active.delete(input.id)
      })
    return run
  }
  return {
    isBusy: () => active.size > 0 || starting.size > 0 || tails.size > 0,
    prepare,
    start,
    get,
    validateForExport,
    submit,
    async cancel(input: { id: string }) {
      cancelRequested.add(input.id)
      active.get(input.id)?.controller.abort()
      return exclusive(input.id, async () => {
        const run = await read(input.id)
        if (!run || !["running", "awaiting_model"].includes(run.state)) return run
        return write({ ...run, state: "canceled", error: null, updatedAt: new Date().toISOString() })
      }).finally(() => cancelRequested.delete(input.id))
    },
    async dispose() {
      active.forEach((task) => task.controller.abort())
      await Promise.allSettled([...active.values()].map((task) => task.work))
    },
  }
}

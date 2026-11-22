import { randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { getImportProject } from "@minemods/mod-core/import-project"
import {
  applyImportChanges,
  exportModifiedImport,
  getImportContext,
  getImportRevision,
} from "@minemods/mod-core/import-edit"
import {
  AnalysisSchema,
  ImportModificationPlanSchema,
  ImportAnalysisContextSchema,
  IMPORT_ANALYSIS_INSTRUCTIONS,
  IMPORT_MODIFICATION_INSTRUCTIONS,
  requestImportAnalysis,
  requestImportModification,
  validateImportAnalysis,
  validateImportModification,
} from "./import-ai"

export const ImportAnalysisRunSchema = z.strictObject({
  id: z.uuid(),
  projectId: z.uuid(),
  kind: z.enum(["analyze", "modify"]),
  state: z.enum(["awaiting_model", "running", "review", "applied", "failed", "canceled"]),
  prompt: z.string().max(20000),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  analysis: AnalysisSchema.nullable(),
  plan: ImportModificationPlanSchema.nullable(),
  revisionId: z.uuid().nullable(),
  error: z.string().max(4000).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type ImportAnalysisRun = z.infer<typeof ImportAnalysisRunSchema>
export class ImportAnalysisError extends Error {}

export const IMPORT_EXPORT_WARNING =
  "导出包可能包含原作者及第三方的代码、脚本和素材。修改与公开分发前，请核对相应许可证并取得必要授权；警示语本身不构成授权。导出成功不代表游戏内效果已验证。"

export function createImportAnalysisService(options: {
  workspaceDirectory: string
  connection: () => { mode?: string; apiKey?: string; baseUrl?: string; model?: string }
  publicError: (error: unknown) => string
  beforeApply?: (id: string) => Promise<void>
}) {
  const active = new Map<string, { controller: AbortController; work: Promise<void> }>()
  const writing = new Set<string>()
  let reading = 0
  const stateDirectory = async (id: string) => {
    const project = await getImportProject(options.workspaceDirectory, id)
    const directory = path.join(project.directory, "runs")
    await mkdir(directory, { recursive: true })
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new ImportAnalysisError("分析运行目录不可用。")
    return directory
  }
  const filename = (runId: string) => `analysis-${z.uuid().parse(runId)}.json`
  const write = async (run: ImportAnalysisRun) => {
    const target = path.join(await stateDirectory(run.projectId), filename(run.id))
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(ImportAnalysisRunSchema.parse(run)), { flag: "wx", mode: 0o600 })
    await rename(temporary, target).finally(() => rm(temporary, { force: true }))
    return run
  }
  const get = async (id: string, runId: string) => {
    const target = path.join(await stateDirectory(id), filename(runId))
    const info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 3_000_000)
      throw new ImportAnalysisError("分析记录过大或格式异常。")
    const run = ImportAnalysisRunSchema.parse(JSON.parse(await readFile(target, "utf8")))
    if (run.projectId !== id || run.id !== runId) throw new ImportAnalysisError("分析记录与工程不匹配。")
    if (run.state === "running" && !active.has(runId))
      return write({
        ...run,
        state: "failed",
        error: "上次分析因应用退出而中断，请重新开始。",
        updatedAt: new Date().toISOString(),
      })
    return run
  }
  const contextFile = async (id: string, runId: string) =>
    path.join(await stateDirectory(id), `context-${z.uuid().parse(runId)}.json`)
  const saveContext = async (id: string, runId: string, context: z.infer<typeof ImportAnalysisContextSchema>) => {
    const target = await contextFile(id, runId)
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(context), { flag: "wx", mode: 0o600 })
    await rename(temporary, target).finally(() => rm(temporary, { force: true }))
  }
  const loadContext = async (id: string, runId: string) => {
    const target = await contextFile(id, runId)
    const info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2_000_000)
      throw new ImportAnalysisError("分析上下文格式异常。")
    return ImportAnalysisContextSchema.parse(JSON.parse(await readFile(target, "utf8")))
  }
  const buildContext = async (id: string, paths?: string[]) => {
    reading++
    try {
      const project = await getImportProject(options.workspaceDirectory, id)
      const report = {
        ...project.report,
        scan: {
          ...project.report.scan,
          status: "partial" as const,
          scope: [...project.report.scan.scope, "AI 上下文仅包含目录索引子集；完整扫描报告仍保存在工程中。"],
        },
        mods: project.report.mods.slice(0, 100),
        categories: Object.fromEntries(
          Object.entries(project.report.categories).map(([kind, category]) => [
            kind,
            {
              ...category,
              entries: category.entries.slice(0, 40),
              truncated: category.truncated || category.entries.length > 40,
            },
          ]),
        ),
        metadata: {
          ...project.report.metadata,
          dependency_files: project.report.metadata.dependency_files.slice(0, 100),
          included_files: project.report.metadata.included_files.slice(0, 100),
        },
      }
      return ImportAnalysisContextSchema.parse({
        ...(await getImportContext({ workspaceDirectory: options.workspaceDirectory, id, paths })),
        report,
      })
    } finally {
      reading--
    }
  }
  const exclusive = async <T>(runId: string, operation: () => Promise<T>) => {
    if (writing.has(runId)) throw new ImportAnalysisError("此分析任务正在保存，请稍后再试。")
    writing.add(runId)
    return operation().finally(() => writing.delete(runId))
  }
  const submit = async (id: string, runId: string, result: unknown) =>
    exclusive(runId, async () => {
      const run = await get(id, runId)
      if (run.state !== "awaiting_model" && run.state !== "running")
        throw new ImportAnalysisError("当前任务已结束或已取消，无法再次提交。")
      const context = await loadContext(id, runId)
      if (context.sourceSha256 !== run.sourceSha256 || context.projectId !== id)
        throw new ImportAnalysisError("输入包与分析快照不一致。")
      const plan = run.kind === "modify" ? validateImportModification(context, result) : null
      const analysis = plan ? plan.analysis : validateImportAnalysis(context, result)
      return write({ ...run, analysis, plan, state: "review", updatedAt: new Date().toISOString() })
    })
  return {
    isBusy: () => active.size > 0 || writing.size > 0 || reading > 0,
    async registerRestored(input: { id: string; revisionId: string }) {
      const project = await getImportProject(options.workspaceDirectory, input.id)
      await getImportRevision({
        workspaceDirectory: options.workspaceDirectory,
        id: input.id,
        revisionId: input.revisionId,
      })
      const time = new Date().toISOString()
      const run = ImportAnalysisRunSchema.parse({
        id: randomUUID(),
        projectId: input.id,
        kind: "modify",
        state: "applied",
        prompt: "从修改工程恢复",
        sourceSha256: project.manifest.source.sha256,
        analysis: null,
        plan: null,
        revisionId: input.revisionId,
        error: null,
        createdAt: time,
        updatedAt: time,
      })
      await saveContext(input.id, run.id, await buildContext(input.id))
      return write(run)
    },
    async start(input: { id: string; prompt?: string; external?: boolean }) {
      const connection = options.connection()
      const external = input.external || connection.mode === "mcp"
      if (!external && !connection.apiKey?.trim())
        throw new ImportAnalysisError("请在设置中连接 AI，或切换到 MCP 模式后由外部模型领取分析任务。")
      if (active.size >= 2) throw new ImportAnalysisError("已有两个分析任务正在运行，请等待完成后再试。")
      const context = await buildContext(input.id)
      const run = ImportAnalysisRunSchema.parse({
        id: randomUUID(),
        projectId: input.id,
        kind: input.prompt?.trim() ? "modify" : "analyze",
        state: external ? "awaiting_model" : "running",
        prompt: input.prompt?.trim() ?? "",
        sourceSha256: context.sourceSha256,
        analysis: null,
        plan: null,
        revisionId: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      const controller = new AbortController()
      const task = { controller, work: Promise.resolve() }
      if (!external) active.set(run.id, task)
      try {
        await saveContext(input.id, run.id, context)
        await write(run)
      } catch (error) {
        active.delete(run.id)
        throw error
      }
      if (external) return run
      task.work = Promise.resolve()
        .then(async () => {
          const settings = {
            apiKey: connection.apiKey!,
            baseUrl: connection.baseUrl,
            model: connection.model,
            signal: controller.signal,
          }
          let currentContext = context
          for (let round = 0; round < 4; round++) {
            controller.signal.throwIfAborted()
            const analysis = (await requestImportAnalysis(currentContext, settings, run.prompt)).result
            const result =
              run.kind === "modify"
                ? (await requestImportModification({ context: currentContext, analysis, prompt: run.prompt }, settings))
                    .result
                : analysis
            const needs = "changeset" in result ? result.analysis.needed_paths : result.needed_paths
            const expanded = needs.length && round < 3 ? await buildContext(input.id, needs) : null
            controller.signal.throwIfAborted()
            if (
              !expanded ||
              expanded.evidence.every((item) =>
                currentContext.evidence.some(
                  (previous) =>
                    previous.path === item.path &&
                    previous.content === item.content &&
                    previous.truncated === item.truncated,
                ),
              )
            ) {
              await submit(input.id, run.id, result)
              return
            }
            if (expanded.revisionId !== context.revisionId)
              throw new ImportAnalysisError("分析期间工程已有新的修改，请重新开始分析。")
            currentContext = ImportAnalysisContextSchema.parse({
              ...expanded,
              evidence: [
                ...new Map(
                  [...currentContext.evidence, ...expanded.evidence].map((entry) => [entry.path, entry]),
                ).values(),
              ],
            })
            if (JSON.stringify(currentContext).length > 210000)
              throw new ImportAnalysisError("分析上下文超出模型请求限制，请缩小分析范围。")
            await saveContext(input.id, run.id, currentContext)
          }
        })
        .catch(async (error: unknown) => {
          const current = await get(input.id, run.id)
          if (current.state === "canceled") return
          await write({
            ...current,
            state: controller.signal.aborted ? "canceled" : "failed",
            error: controller.signal.aborted ? null : options.publicError(error),
            updatedAt: new Date().toISOString(),
          })
        })
        .catch(() => undefined)
        .finally(() => {
          active.delete(run.id)
        })
      return run
    },
    get,
    async list(id: string) {
      const names = (await readdir(await stateDirectory(id)))
        .filter((name) => /^analysis-[0-9a-f-]{36}\.json$/.test(name))
        .slice(-200)
      const records = await Promise.allSettled(names.map((name) => get(id, name.slice(9, -5))))
      return records
        .flatMap((value) => (value.status === "fulfilled" ? [value.value] : []))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async task(input: { id: string; runId: string; paths?: string[] }) {
      return exclusive(input.runId, async () => {
        const run = await get(input.id, input.runId)
        if (input.paths?.length && !["awaiting_model", "running"].includes(run.state))
          throw new ImportAnalysisError("此任务已经结束，补充证据前请开始新任务。")
        const previous = await loadContext(input.id, input.runId)
        const context = input.paths?.length ? await buildContext(input.id, input.paths) : previous
        if (input.paths?.length) {
          if (context.revisionId !== previous.revisionId)
            throw new ImportAnalysisError("工程已有新的修改，请重新开始分析以使用一致的文件快照。")
          const combined = ImportAnalysisContextSchema.parse({
            ...context,
            evidence: [
              ...new Map([...previous.evidence, ...context.evidence].map((entry) => [entry.path, entry])).values(),
            ],
          })
          if (JSON.stringify(combined).length > 500000)
            throw new ImportAnalysisError("上下文已达到上限，请缩小这次修改范围并新建任务。")
          await saveContext(input.id, input.runId, combined)
        }
        return {
          run,
          context: await loadContext(input.id, input.runId),
          instructions: run.kind === "modify" ? IMPORT_MODIFICATION_INSTRUCTIONS : IMPORT_ANALYSIS_INSTRUCTIONS,
          outputSchema: z.toJSONSchema(run.kind === "modify" ? ImportModificationPlanSchema : AnalysisSchema),
          warning: IMPORT_EXPORT_WARNING,
        }
      })
    },
    submit,
    async cancel(id: string, runId: string) {
      active.get(runId)?.controller.abort()
      return exclusive(runId, async () => {
        const run = await get(id, runId)
        if (!["running", "awaiting_model"].includes(run.state)) return run
        return write({ ...run, state: "canceled", updatedAt: new Date().toISOString() })
      })
    },
    async apply(id: string, runId: string) {
      return exclusive(runId, async () => {
        await options.beforeApply?.(id)
        const run = await get(id, runId)
        if (run.state !== "review" || !run.plan) throw new ImportAnalysisError("请先完成并查看修改方案。")
        if (!run.plan.changeset.changes.length)
          throw new ImportAnalysisError("当前方案没有可应用的修改，请根据证据缺口补充上下文后重新生成。")
        const context = await loadContext(id, runId)
        const result = await applyImportChanges({
          workspaceDirectory: options.workspaceDirectory,
          id,
          changeset: run.plan.changeset,
          parentRevisionId: context.revisionId,
        })
        return write({ ...run, state: "applied", revisionId: result.revisionId, updatedAt: new Date().toISOString() })
      })
    },
    async export(input: { id: string; runId: string; destination: string; kind: "archive" | "project" }) {
      return exclusive(input.runId, async () => {
        const run = await get(input.id, input.runId)
        if (run.state !== "applied" || !run.revisionId)
          throw new ImportAnalysisError("请先应用修改方案，再导出修改后的包或工程。")
        return exportModifiedImport({
          workspaceDirectory: options.workspaceDirectory,
          id: input.id,
          revisionId: run.revisionId,
          destination: input.destination,
          kind: input.kind,
        })
      })
    },
    async dispose() {
      active.forEach((task) => task.controller.abort())
      await Promise.allSettled([...active.values()].map((task) => task.work))
    },
  }
}

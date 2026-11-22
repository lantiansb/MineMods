import { randomUUID } from "node:crypto"
import path from "node:path"
import {
  listManagedEnvironment,
  deleteManagedEnvironment,
  cleanUnusedEnvironment,
  prepareManagedEnvironment,
  type EnvironmentReference,
} from "@minemods/mod-core/environment"
import * as imports from "@minemods/mod-core/import-project"
import { restoreModificationProject } from "@minemods/mod-core/import-edit"
import { restoreReverseProject } from "@minemods/mod-core/reverse-project"
import { LibraryTaskSchema, type LibraryTask } from "../library"

export class LibraryError extends Error {}

/**
 * The Java a build, check or preparation uses, found again each time (2026-10-08): the person may pick another one or
 * install Studio's own while the app is open. `external` is a Java that is not Studio's own, listed on the storage page.
 */
export type JavaUse = { javaHome?: string; javaDirectory?: string; external?: string }

export function createLibraryService(options: {
  workspaceDirectory: string
  runtimeDirectory: string
  java?: () => Promise<JavaUse>
  references: () => Promise<EnvironmentReference[]>
  runtimeBusy: () => boolean
  importBusy?: () => boolean
  publicError: (error: unknown) => string
  onRestored?: (input: { id: string; revisionId: string }) => Promise<void>
}) {
  const tasks = new Map<string, { value: LibraryTask; controller: AbortController; work: Promise<void> }>()
  const preparing = () =>
    [...tasks.values()].some(
      (task) => task.value.kind === "prepare-environment" && ["running", "canceling"].includes(task.value.state),
    )
  const busy = () => options.runtimeBusy() || preparing() || !!options.importBusy?.()
  const java = async (): Promise<JavaUse> => (options.java ? options.java() : {})
  const environmentInput = async () => {
    const use = await java()
    return {
      runtimeDirectory: options.runtimeDirectory,
      projectReferences: await options.references(),
      inUse: busy() ? ["java-21", "gradle-home", "fabric-1.21.1", "reverse-tools"] : [],
      externalJavaHome: use.external,
      javaDirectory: use.javaDirectory,
    }
  }
  const taskFor = (id: string) => {
    const task = tasks.get(id)
    if (!task) throw new LibraryError("任务记录已失效，请在导入工程列表中查看已保存的扫描结果。")
    return task
  }
  // An operation may end with words of its own for the person (what it installed and how big it is), else the kind's own.
  const start = (
    kind: LibraryTask["kind"],
    operation: (signal: AbortSignal, progress: (detail: string) => void) => Promise<string | null | { detail: string }>,
  ) => {
    if ([...tasks.values()].filter((task) => ["running", "canceling"].includes(task.value.state)).length >= 2)
      throw new LibraryError("已有两个任务正在进行，请等待完成或取消后再试。")
    if (tasks.size >= 100) {
      const finished = [...tasks.values()].find((task) => !["running", "canceling"].includes(task.value.state))
      if (finished) tasks.delete(finished.value.id)
    }
    const value = LibraryTaskSchema.parse({
      id: randomUUID(),
      kind,
      state: "running",
      detail: "准备中",
      resultId: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    })
    const controller = new AbortController()
    const task = { value, controller, work: Promise.resolve() }
    tasks.set(value.id, task)
    task.work = Promise.resolve()
      .then(() =>
        operation(controller.signal, (detail) => {
          task.value.detail = detail.slice(-4000)
        }),
      )
      .then((result) => {
        task.value = {
          ...task.value,
          state: "completed",
          resultId: typeof result === "string" ? result : null,
          detail:
            result !== null && typeof result === "object"
              ? result.detail.slice(0, 4000)
              : kind === "scan-import"
                ? "扫描结果已保存到独立工程。"
                : "Java 开发环境已准备好。其他构建依赖将在首次构建时下载。",
          finishedAt: new Date().toISOString(),
        }
      })
      .catch((error: unknown) => {
        task.value = {
          ...task.value,
          state: controller.signal.aborted ? "canceled" : "failed",
          error: controller.signal.aborted ? null : options.publicError(error),
          detail: controller.signal.aborted ? "任务已取消。" : "任务未完成。",
          finishedAt: new Date().toISOString(),
        }
      })
    return structuredClone(value)
  }
  return {
    async listEnvironmentStorage() {
      return listManagedEnvironment(await environmentInput())
    },
    async removeEnvironment(input: { id: string; confirmReferenced?: boolean }) {
      const environment = await environmentInput()
      if (busy()) throw new LibraryError("环境正在下载、构建或试玩，请等待任务结束后再清理。")
      return deleteManagedEnvironment({ ...environment, ...input })
    },
    /** 「清理没用的」: every downloaded thing nobody needs any more, never while something is running. */
    async cleanUnusedEnvironment() {
      const environment = await environmentInput()
      if (busy()) throw new LibraryError("环境正在下载、构建或试玩，请等待任务结束后再清理。")
      return cleanUnusedEnvironment(environment)
    },
    prepareEnvironment(input: { profileId: "fabric-1.21.1" }) {
      if (busy()) throw new LibraryError("环境正在使用，请等待当前下载、构建或试玩结束。")
      return start("prepare-environment", async (signal, onProgress) => {
        const use = await java()
        await prepareManagedEnvironment({
          runtimeDirectory: options.runtimeDirectory,
          javaHome: use.javaHome,
          javaDirectory: use.javaDirectory,
          profileId: input.profileId,
          signal,
          onProgress,
        })
        return null
      })
    },
    /**
     * 一键安装 Java (2026-10-08): runs as a preparation task, so the window follows it the way it follows 「准备环境」 and
     * nothing else touching the environment runs beside it. `install` does the work and returns the words it ends with.
     */
    installJava(install: (signal: AbortSignal, progress: (detail: string) => void) => Promise<string>) {
      if (busy()) throw new LibraryError("环境正在使用，请等待当前下载、构建或试玩结束。")
      return start("prepare-environment", async (signal, onProgress) => ({ detail: await install(signal, onProgress) }))
    },
    startImportSource(filename: string) {
      return start("scan-import", async (signal, onProgress) => {
        if (path.extname(filename).toLowerCase() === ".modreverse") {
          signal.throwIfAborted()
          const restored = await restoreReverseProject({
            workspaceDirectory: options.workspaceDirectory,
            filename,
            signal,
          })
          if (signal.aborted) {
            await imports.deleteImportProject(options.workspaceDirectory, restored.project.id)
            signal.throwIfAborted()
          }
          return restored.project.id
        }
        if (path.extname(filename).toLowerCase() === ".modwork") {
          signal.throwIfAborted()
          const restored = await restoreModificationProject({
            workspaceDirectory: options.workspaceDirectory,
            filename,
          })
          try {
            signal.throwIfAborted()
            await options.onRestored?.({ id: restored.manifest.id, revisionId: restored.revisionId })
            signal.throwIfAborted()
          } catch (error) {
            await imports.deleteImportProject(options.workspaceDirectory, restored.manifest.id).catch(() => undefined)
            throw error
          }
          return restored.manifest.id
        }
        const result = await imports.importProject({
          workspaceDirectory: options.workspaceDirectory,
          filename,
          signal,
          onProgress: (value) => onProgress(`${value.phase} · ${value.completed} / ${value.total}`),
        })
        return result.manifest.id
      })
    },
    getLibraryTask(id: string) {
      return LibraryTaskSchema.parse(structuredClone(taskFor(id).value))
    },
    listLibraryTasks() {
      return [...tasks.values()].map((task) => LibraryTaskSchema.parse(structuredClone(task.value))).reverse()
    },
    cancelLibraryTask(id: string) {
      const task = taskFor(id)
      if (task.value.state === "running") {
        task.value.state = "canceling"
        task.value.detail = "正在取消并清理临时文件…"
        task.controller.abort()
      }
      return structuredClone(task.value)
    },
    listImportedProjects() {
      return imports.listImportProjects(options.workspaceDirectory)
    },
    listImportedProjectIssues() {
      return imports.listImportProjectIssues(options.workspaceDirectory)
    },
    getImportedProject(id: string) {
      return imports.getImportProject(options.workspaceDirectory, id)
    },
    async deleteImportedProject(id: string) {
      if (options.importBusy?.()) throw new LibraryError("正在分析、应用或导出工程，请等待操作结束后再删除。")
      await imports.deleteImportProject(options.workspaceDirectory, id)
    },
    async clearImportedCache(id: string) {
      if (options.importBusy?.()) throw new LibraryError("正在读取或处理导入文件，请等待操作结束后再清理临时资料。")
      await imports.clearImportCache(options.workspaceDirectory, id)
    },
    exportImportedReportTo(id: string, destination: string) {
      return imports.exportImportReport({ workspaceDirectory: options.workspaceDirectory, id, destination })
    },
    async dispose() {
      tasks.forEach((task) => task.controller.abort())
      await Promise.allSettled([...tasks.values()].map((task) => task.work))
    },
  }
}

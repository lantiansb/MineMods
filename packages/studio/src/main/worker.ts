import { createStudioService, dispatchStudioRequest, publicError } from "./service"
import { WorkerMessageSchema, WorkerShutdownSchema, ConnectionStoreReplySchema, LookProgressSchema, LookReplySchema } from "./protocol"
import type { LookPictures, LookProgress, LookRenderer } from "./look-job"
import { createWorkerLifecycle, WorkerClosingError } from "./lifecycle"
import { randomUUID } from "node:crypto"
import type { ConnectionStore } from "./connection-store"
import { dispatchExternal, externalError } from "./external-dispatch"

const port = (
  process as typeof process & {
    parentPort?: {
      postMessage(message: unknown): void
      on(event: "message", listener: (event: { data: unknown }) => void): void
    }
  }
).parentPort

if (!port) throw new Error("MineMods Studio worker requires a parent process")

type ConnectionValue = Awaited<ReturnType<ConnectionStore["load"]>>
const connectionPending = new Map<
  string,
  { resolve: (value: ConnectionValue) => void; reject: (error: Error) => void }
>()
const connectionRequest = (value?: Parameters<ConnectionStore["save"]>[0]) =>
  new Promise<ConnectionValue>((resolve, reject) => {
    const id = randomUUID()
    const timer = setTimeout(() => {
      connectionPending.delete(id)
      reject(new Error("连接设置存储超时。"))
    }, 15000)
    connectionPending.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    })
    port.postMessage(value ? { type: "connection-save", id, value } : { type: "connection-load", id })
  })
port.on("message", (event) => {
  const parsed = ConnectionStoreReplySchema.safeParse(event.data)
  if (!parsed.success) return
  const pending = connectionPending.get(parsed.data.id)
  if (!pending) return
  connectionPending.delete(parsed.data.id)
  if (parsed.data.ok) pending.resolve(parsed.data.value)
  if (!parsed.data.ok) pending.reject(new Error(parsed.data.error))
})

// Looks are drawn by the main process, which owns the windows. An answer that never comes is an answer too:
// the wait covers a few looks queued ahead of this one, each with its own time limit over there.
const lookPending = new Map<string, (result: LookPictures) => void>()
const lookProgress = new Map<string, LookProgress>()
const look: LookRenderer = (job, progress, signal) =>
  new Promise((resolve) => {
    const id = randomUUID()
    const finish = (result: LookPictures) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", cancel)
      lookPending.delete(id)
      lookProgress.delete(id)
      resolve(result)
    }
    const stop = (reason: string) => {
      finish({ ok: false, reason })
      port.postMessage({ type: "look-cancel", id })
    }
    const cancel = () => stop("已经取消这次预览。")
    const timer = setTimeout(() => stop("预览图迟迟没有画出来，已经放弃这一次。"), 240_000)
    if (signal?.aborted) return finish({ ok: false, reason: "已经取消这次预览。" })
    signal?.addEventListener("abort", cancel, { once: true })
    lookPending.set(id, finish)
    if (progress) lookProgress.set(id, progress)
    port.postMessage({ type: "look-render", id, job, ...(progress ? { progress: true } : {}) })
  })
port.on("message", (event) => {
  const progress = LookProgressSchema.safeParse(event.data)
  if (progress.success) {
    lookProgress.get(progress.data.id)?.(progress.data.done, progress.data.total)
    return
  }
  const parsed = LookReplySchema.safeParse(event.data)
  if (!parsed.success) return
  lookPending.get(parsed.data.id)?.(parsed.data.result)
})

// 工具资产: the keys the person saved for tools are kept encrypted by the main process (the system's key store is there); asked for only when a run needs them.
const toolSecretPending = new Map<string, (value: Record<string, string>) => void>()
const toolSecrets = () =>
  new Promise<Record<string, string>>((resolve) => {
    const id = randomUUID()
    const timer = setTimeout(() => {
      toolSecretPending.delete(id)
      resolve({})
    }, 15000)
    toolSecretPending.set(id, (value) => {
      clearTimeout(timer)
      resolve(value)
    })
    port.postMessage({ type: "tool-secrets-load", id })
  })
port.on("message", (event) => {
  const data = event.data as { type?: unknown; id?: unknown; value?: unknown } | null
  if (!data || data.type !== "tool-secrets-result" || typeof data.id !== "string") return
  const value = data.value && typeof data.value === "object" ? Object.fromEntries(Object.entries(data.value).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {}
  toolSecretPending.get(data.id)?.(value)
  toolSecretPending.delete(data.id)
})

const service = createStudioService({
  toolSecrets,
  onToolsChanged: () => port.postMessage({ type: "tools-changed" }),
  workspaceDirectory: process.env.MINEMODS_STUDIO_WORKSPACE!,
  runtimeDirectory: process.env.MINEMODS_STUDIO_RUNTIME!,
  templateDirectory: process.env.MINEMODS_STUDIO_TEMPLATES!,
  // Only an explicit Studio setting is binding. A system JAVA_HOME is tried by ensureJava and skipped
  // when it is missing or not Java 21, so a stale variable cannot block builds.
  javaHome: process.env.MINEMODS_STUDIO_JAVA_HOME || undefined,
  // The making loop is on unless this is set: a way back for a machine on which the hidden window cannot draw.
  look: process.env.MINEMODS_STUDIO_LOOKS === "off" ? undefined : look,
  // 提前准备: downloads in the background once there is a mod to pack soon. Not in a test run of the app, and not where the developer turned it off.
  onTrace: () => port.postMessage({ type: "trace-changed" }),
  ahead: { on: process.env.MINEMODS_STUDIO_TEST !== "1" && process.env.MINEMODS_STUDIO_AHEAD !== "off", changed: () => port.postMessage({ type: "ahead-changed" }) },
  connectionStore: {
    load: () => connectionRequest(),
    save: async (value) => {
      await connectionRequest(value)
    },
  },
  ai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.MINEMODS_STUDIO_MODEL,
    serviceUrl: process.env.STUDIO_AI_URL,
    serviceToken: process.env.STUDIO_SERVICE_TOKEN,
    routerModel: process.env.MINEMODS_STUDIO_ROUTER_MODEL,
    moduleModel: process.env.MINEMODS_STUDIO_ASSET_MODEL,
    transcriptionBaseUrl: process.env.MINEMODS_STUDIO_TRANSCRIPTION_BASE_URL,
    transcriptionModel: process.env.MINEMODS_STUDIO_TRANSCRIPTION_MODEL,
  },
})
const lifecycle = createWorkerLifecycle(() => service.then((value) => value.dispose()))

service
  .then(() => port.postMessage({ type: "ready" }))
  .catch((error: unknown) => {
    port.postMessage({ type: "startup-error", error: publicError(error) })
  })

port.on("message", (event) => {
  const shutdown = WorkerShutdownSchema.safeParse(event.data)
  if (shutdown.success) {
    lifecycle
      .shutdown()
      .then(() => port.postMessage({ id: shutdown.data.id, ok: true, value: null }))
      .catch((error: unknown) => port.postMessage({ id: shutdown.data.id, ok: false, error: publicError(error) }))
      .finally(() => setImmediate(() => process.exit(0)))
    return
  }
  const message = WorkerMessageSchema.safeParse(event.data)
  if (!message.success) return
  lifecycle
    .accept(() =>
      service.then(async (value): Promise<unknown> => {
        const request = message.data.request
        if (request.method === "externalCall")
          return dispatchExternal(value, request.input).catch((error) => {
            throw externalError(error)
          })
        if (request.method === "getConnection") return value.getConnection()
        if (request.method === "saveConnection") return value.saveConnection(request.input)
        if (request.method === "testConnection") return value.testConnection(request.input)
        if (request.method === "listConnectionModels") return value.listConnectionModels(request.input)
        if (request.method === "getExternalProgress") return value.externalRunner.getExternalProgress(request.input)
        return dispatchStudioRequest(value, request)
      }),
    )
    .then((value) => port.postMessage({ id: message.data.id, ok: true, value }))
    .catch((error: unknown) =>
      port.postMessage({
        id: message.data.id,
        ok: false,
        error: error instanceof WorkerClosingError ? error.message : publicError(error),
      }),
    )
})

process.on("SIGTERM", () => {
  lifecycle.shutdown().finally(() => process.exit(0))
})

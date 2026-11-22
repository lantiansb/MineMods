import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { z } from "zod"
import {
  ExternalBridgeDescriptorSchema,
  ExternalBridgeRequestSchema,
  ExternalBridgeMethodSchema,
  type ExternalBridgeDescriptor,
  type ExternalBridgeMethod,
} from "../external"
import { REFERENCE_LIMITS } from "@minemods/studio-ai/making"
import { SCRIPT_LIMITS } from "@minemods/studio-ai/script"
import { createPresence, type PresenceSnapshot } from "../mcp-presence"

/**
 * The steps of an outside AI after which a run's tasks stand differently. The window asks for runs about once
 * a second; told right after one of these, it asks at once, so an open card follows a commit without the wait.
 */
export const EXTERNAL_TASK_STEPS: ReadonlySet<ExternalBridgeMethod> = new Set(["startExternal", "claimExternalTask", "commitExternalTask", "failExternalTask", "cancelExternalRun", "nextBatch"])

export type ExternalMcpBridgeCall = (method: ExternalBridgeMethod, input: unknown) => Promise<unknown>
export type ExternalMcpActivity = {
  lastActivity: number
  connected: boolean
  sessionId?: string
  client?: string
  shutdown?: boolean
}

export type ExternalMcpBridge = {
  start(): Promise<ExternalBridgeDescriptor>
  stop(): Promise<void>
  dispatch(method: ExternalBridgeMethod, input: unknown, authorization?: string, sessionId?: string): Promise<unknown>
  descriptor(): ExternalBridgeDescriptor | null
  status(): PresenceSnapshot & { lastActivity: number | null; madeProject: MadeProject | null }
}

/** The newest project an outside AI created, as the window is told of it: it opens that project, or offers to. */
export type MadeProject = { id: string; name: string; at: number }

function json(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  })
  response.end(body)
}

function tokenFromAuthorization(authorization: string | undefined) {
  const prefix = "Bearer "
  if (!authorization?.startsWith(prefix)) return null
  return authorization.slice(prefix.length)
}

/**
 * How large a request to the bridge may be, in bytes, and where each number comes from. Four sizes, because these calls carry different things:
 * - `plain`: every call that carries only words and ids: the ordinary cap the bridge has always had. 1,000,000 is far above the largest of them
 *   (a plan request is a 20,000-character prompt, 60 KB in Chinese, and its plan) and is kept so that nothing that worked before is refused now.
 * - `document`: `update_task`, `look` and `commit_task` hand a whole model, texture or animation in as JSON. The most they may carry is what Studio itself
 *   accepts a script to hand back, `SCRIPT_LIMITS.output` (4,000,000 characters, so the two ways of handing a document in share one ceiling), plus
 *   `envelope`. Measured on the biggest document the epic tier allows (192 bones, 1,024 cubes, 32 motions and 39,936 keys in three tracks of
 *   smooth keys, the tier's 40,000-key ceiling in `studio-ai/src/budget.ts`) with numbers to four decimals, as a modeller writes them: 3,490,009
 *   bytes as the bridge sends it (compact JSON; 87 bytes a key counting the geometry), so the ceiling leaves it 14% for longer numbers. A document
 *   written with fifteen-digit numbers would not fit, here or as a script's output, and the refusal says to keep two or three decimals.
 *   Measured again in `test/external-mcp.test.ts`.
 * - `concepts`: `save_concepts` hands in up to `REFERENCE_LIMITS.concept` (3) pictures as data URLs. Studio accepts a picture of at most
 *   `REFERENCE_LIMITS.bytes` (4 MiB) decoded; base64 writes 4 characters for every 3 bytes (rounded up), and the data URL adds its `data:image/webp;base64,`
 *   (23 characters) in front, so a picture is at most 5,592,431 characters; three of them and `envelope` is the cap (about 16.8 MB).
 * - `singlePicture`: `finish_six_view` carries one picture at that same 4 MiB decoded ceiling, its name and `envelope` (about 5.7 MB).
 * `envelope`: what else a call carries beside its document or pictures: three ids (about 150 bytes), a progress note of 4,000 characters (12,000 bytes in
 * Chinese) and punctuation. The script itself (180,000 UTF-16 units, at most 1.08 MB in escaped JSON) counts towards the document body, not this envelope.
 * Model scripts replace their document. Drawing scripts can share this body budget with the small document that receives the drawing.
 */
export const BRIDGE_BODY = (() => {
  const envelope = 64 * 1024
  const picture = 4 * Math.ceil(REFERENCE_LIMITS.bytes / 3) + "data:image/webp;base64,".length
  const document = SCRIPT_LIMITS.output + envelope
  const concepts = REFERENCE_LIMITS.concept * (picture + REFERENCE_LIMITS.name * 3) + envelope
  const singlePicture = picture + REFERENCE_LIMITS.name * 3 + envelope
  return { plain: 1_000_000, document, concepts, singlePicture, most: Math.max(document, concepts, singlePicture), envelope } as const
})()

/** The calls that carry a whole document. Picture calls have their own caps; every other call is `plain`. */
const DOCUMENT_CALLS: ReadonlySet<ExternalBridgeMethod> = new Set(["updateExternalTask", "commitExternalTask", "lookExternalTask"])

/** The most bytes a request of this method may carry. */
export const bodyLimit = (method: ExternalBridgeMethod) => (method === "finishThreeView" ? BRIDGE_BODY.singlePicture : method === "conceptExternalTask" ? BRIDGE_BODY.concepts : DOCUMENT_CALLS.has(method) ? BRIDGE_BODY.document : BRIDGE_BODY.plain)

const megabytes = (bytes: number) => (Math.round((bytes / 1_000_000) * 10) / 10).toFixed(1)

/** What a person or an outside AI is told when a request is larger than its call allows: what was too big and what to do instead, in plain words. */
export function tooLargeWords(method: ExternalBridgeMethod, bytes: number) {
  const sent = `这一次交来的内容有 ${megabytes(bytes)} MB，超过了这一步一次能收的 ${megabytes(bodyLimit(method))} MB。`
  if (method === "finishThreeView")
    return `${sent}六视图只收一张 PNG、JPEG 或 WebP 图片，解开以后不能超过 ${REFERENCE_LIMITS.bytes / 1024 / 1024} MiB；请缩小尺寸或改存 JPEG / WebP 后，用 data URL 再交。`
  if (method === "conceptExternalTask")
    return `${sent}构想图最多 ${REFERENCE_LIMITS.concept} 张，每张解开以后不能超过 ${REFERENCE_LIMITS.bytes / 1024 / 1024} MB：把大的那张缩小尺寸，或者存成 JPEG / WebP 再交；一次交不下就少交一张（再交一次 save_concepts 会换掉之前交的，不能分几次累加）。`
  if (DOCUMENT_CALLS.has(method))
    return `${sent}把整份文档逐个关键帧写进 draft / document 太占地方：改成交脚本（update_task、look、commit_task 都有 script，写一段最后 return 文档的 JavaScript，最多 ${SCRIPT_LIMITS.source} 个字符，由 Studio 在本机运行，数字留两三位小数就够）。脚本交出的文档同样不能超过 ${megabytes(SCRIPT_LIMITS.output)} MB；脚本交出来还是超了，就是文档本身太大，要减少关键帧或面上的细节，而不是换个办法交。`
  return `${sent}这一步只需要几行字和编号，不该带整份文档或图片；检查是不是把别的东西塞进来了。`
}

async function body(request: IncomingMessage, limit: number) {
  const chunks: Buffer[] = []
  let length = 0
  // A body-limit refusal must reach the caller before the unfinished request is closed. The default
  // iterator destroys IncomingMessage when this loop throws, which can end Bun's response as an empty 200.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += value.length
    // Stops reading at the largest any call may carry, and says so in the words of the call it is, since the method is not known until the whole body is read.
    if (length > limit) throw new Error(`这一次交来的内容超过了一次能收的上限（${megabytes(limit)} MB），没有收下。整份文档请改交脚本（script），构想图请缩小后再交。`)
    chunks.push(value)
  }
  const raw = Buffer.concat(chunks)
  return { value: JSON.parse(raw.toString("utf8")) as unknown, bytes: raw.length }
}

export function createExternalMcpBridge(options: {
  token: string
  call: ExternalMcpBridgeCall
  onActivity?: (activity: ExternalMcpActivity) => void
  /** Told when a step that changes a run's tasks has ended, refused or not: a refusal can end a task too. */
  onChanged?: (method: ExternalBridgeMethod) => void
  port?: number
  host?: "127.0.0.1"
}): ExternalMcpBridge {
  const token = z.string().min(32).max(256).parse(options.token)
  const host = options.host ?? "127.0.0.1"
  let server: Server | undefined
  let connection: ExternalBridgeDescriptor | null = null
  let lastActivity: number | null = null
  // Kept here, where the call passes through, because the window only polls the status and would otherwise never learn that a project appeared.
  let madeProject: MadeProject | null = null
  const presence = createPresence({ alive: (pid) => { try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM" } } })

  async function dispatch(method: ExternalBridgeMethod, input: unknown, authorization?: string, sessionId?: string) {
    if (tokenFromAuthorization(authorization) !== token) throw new Error("外部 MCP bridge token 无效。")
    lastActivity = Date.now()
    const parsed = ExternalBridgeMethodSchema.parse(method)
    if (parsed === "heartbeat") {
      const heartbeat = z
        .strictObject({
          sessionId: z.string().trim().min(1).max(120),
          client: z.string().trim().min(1).max(120).optional(),
          shutdown: z.boolean().optional(),
          presenceVersion: z.literal(1).optional(),
          pid: z.number().int().positive().optional(),
        })
        .parse(input)
      presence.report(heartbeat)
      if (heartbeat.shutdown) {
        options.onActivity?.({
          lastActivity,
          connected: false,
          sessionId: heartbeat.sessionId,
          client: heartbeat.client,
          shutdown: true,
        })
        return { connected: false, lastActivity, sessionId: heartbeat.sessionId, client: heartbeat.client ?? null }
      }
      options.onActivity?.({ lastActivity, connected: true, sessionId: heartbeat.sessionId, client: heartbeat.client })
      return { connected: true, lastActivity, sessionId: heartbeat.sessionId, client: heartbeat.client ?? null }
    }
    options.onActivity?.({ lastActivity, connected: true })
    presence.tool(sessionId)
    const data = z.object({ taskId: z.string().optional(), runId: z.string().optional() }).passthrough().safeParse(input)
    const taskId = data.success ? data.data.taskId : undefined
    const invoke = async () => {
      const value = await options.call(parsed, input)
      // Progress handed in on a task is work on it too: a new conversation that goes on with one it did not take holds it from then on.
      if (taskId && parsed === "updateExternalTask") {
        const run = data.success ? data.data.runId : undefined
        presence.task(sessionId, taskId, z.object({ task: z.object({ title: z.string() }) }).passthrough().safeParse(value).data?.task.title ?? taskId, run)
      }
      if (taskId && parsed === "claimExternalTask") {
        const task = z.object({ task: z.object({ title: z.string() }) }).passthrough().safeParse(value)
        presence.task(sessionId, taskId, task.success ? task.data.task.title : taskId, data.success ? data.data.runId : undefined)
      }
      if (taskId && ["commitExternalTask", "failExternalTask"].includes(parsed)) presence.task(sessionId, taskId, null)
      if (parsed === "cancelExternalRun" && data.success && data.data.runId) presence.cancel(data.data.runId)
      return value
    }
    if (parsed === "createProject")
      return invoke().then((value) => {
        const made = z.object({ project: z.object({ id: z.string(), name: z.string() }) }).safeParse(value)
        // Only a project that really exists is announced; a refused call raised before this point.
        if (made.success) madeProject = { id: made.data.project.id, name: made.data.project.name, at: Date.now() }
        return value
      })
    if (!EXTERNAL_TASK_STEPS.has(parsed)) return invoke()
    return invoke().finally(() => options.onChanged?.(parsed))
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method !== "POST" || request.url !== "/mcp") {
      json(response, 404, { error: "Not Found" })
      return
    }
    if (request.headers.origin) {
      json(response, 403, { error: "Origin 不受信任。" })
      return
    }
    const address = server?.address()
    const port = address && typeof address !== "string" ? address.port : null
    const hostHeader = request.headers.host?.toLowerCase()
    if (!port || !hostHeader || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(hostHeader)) {
      json(response, 403, { error: "Host 不受信任。" })
      return
    }
    try {
      // Only a caller that holds the token is read up to the largest body any call may carry; any other is read up to the ordinary cap, and is then refused as before.
      const trusted = tokenFromAuthorization(request.headers.authorization) === token
      const read = await body(request, trusted ? BRIDGE_BODY.most : BRIDGE_BODY.plain)
      const parsed = ExternalBridgeRequestSchema.parse(read.value)
      if (trusted && read.bytes > bodyLimit(parsed.method)) throw new Error(tooLargeWords(parsed.method, read.bytes))
      const value = await dispatch(parsed.method, parsed.input, request.headers.authorization, parsed.sessionId)
      json(response, 200, { ok: true, value })
    } catch (error) {
      if (!request.complete) response.once("finish", () => request.destroy())
      json(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    start: async () => {
      if (server && connection) return connection
      server = createServer((request, response) => void handle(request, response))
      await new Promise<void>((resolve, reject) => {
        const current = server!
        current.once("error", reject)
        current.listen(options.port ?? 0, host, () => {
          current.off("error", reject)
          resolve()
        })
      })
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("外部 MCP bridge 未能取得本地端口。")
      connection = ExternalBridgeDescriptorSchema.parse({ url: `http://${host}:${address.port}/mcp`, token })
      return connection
    },
    stop: async () => {
      const current = server
      server = undefined
      connection = null
      if (!current) return
      // Stop active bridge calls before closing the listener. Bun also closes the listener here.
      current.closeAllConnections()
      if (current.listening)
        await new Promise<void>((resolve, reject) => current.close((error) => (error ? reject(error) : resolve())))
    },
    dispatch,
    descriptor: () => connection,
    status: () => {
      const status = presence.snapshot()
      return { ...status, connected: Boolean(server) && status.connected, clients: server ? status.clients : 0, lastActivity, madeProject }
    },
  }
}

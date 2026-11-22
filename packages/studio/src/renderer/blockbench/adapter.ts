import { makeBlockbenchEnvelope, parseBlockbenchEnvelope } from "../../main/blockbench/ipc"
import { createBlockbenchSession, type BlockbenchSession, type BlockbenchTransport } from "../../main/blockbench/session"
import type { BlockbenchEnvelope } from "../../main/blockbench/protocol"

type PendingRequest = {
  resolve: (value: BlockbenchEnvelope) => void
  reject: (reason: Error) => void
  timer: number
}

export type BlockbenchFrameAdapter = BlockbenchTransport & {
  sessionId: string
  nonce: string
  dispose: () => void
}

const token = () => crypto.randomUUID().replaceAll("-", "")

export function createBlockbenchFrameAdapter(options: {
  iframe: HTMLIFrameElement
  origin: string
  sessionId?: string
  nonce?: string
  timeoutMs?: number
}): BlockbenchFrameAdapter {
  const sessionId = options.sessionId ?? token()
  const nonce = options.nonce ?? token()
  const pending = new Map<string, PendingRequest>()
  const context = { origin: options.origin, sessionId, nonce }
  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== options.iframe.contentWindow) return
    if (event.origin !== options.origin) return
    let envelope: BlockbenchEnvelope
    try {
      envelope = parseBlockbenchEnvelope(event.data, event.origin, context)
    } catch {
      return
    }
    if (envelope.kind !== "response") return
    const request = pending.get(envelope.requestId)
    if (!request) return
    window.clearTimeout(request.timer)
    pending.delete(envelope.requestId)
    request.resolve(envelope)
  }
  window.addEventListener("message", onMessage)
  return {
    sessionId,
    nonce,
    request: (envelope: BlockbenchEnvelope) => new Promise((resolve, reject) => {
      if (envelope.kind !== "request") {
        reject(new Error("Blockbench adapter only sends request envelopes"))
        return
      }
      const requestId = envelope.requestId
      const timer = window.setTimeout(() => {
        pending.delete(requestId)
        reject(new Error("Blockbench request timed out"))
      }, options.timeoutMs ?? 20_000)
      pending.set(requestId, { resolve, reject, timer })
      options.iframe.contentWindow?.postMessage(makeBlockbenchEnvelope(envelope), options.origin)
    }),
    dispose: () => {
      window.removeEventListener("message", onMessage)
      pending.forEach((request) => {
        window.clearTimeout(request.timer)
        request.reject(new Error("Blockbench adapter disposed"))
      })
      pending.clear()
    },
  }
}

export function createBlockbenchSessionFromFrame(options: {
  iframe: HTMLIFrameElement
  origin: string
  projectId: string
  assetId: string
  initialRevision?: number
  timeoutMs?: number
}): { session: BlockbenchSession; adapter: BlockbenchFrameAdapter } {
  const adapter = createBlockbenchFrameAdapter(options)
  return {
    adapter,
    session: createBlockbenchSession({
      projectId: options.projectId,
      assetId: options.assetId,
      initialRevision: options.initialRevision,
      sessionId: adapter.sessionId,
      nonce: adapter.nonce,
      transport: adapter,
    }),
  }
}

import { BrowserWindow } from "electron"
import { randomUUID } from "node:crypto"
import { setTimeout } from "node:timers/promises"
import { BlockbenchTaskSchema, BoundedSnapshotSchema, type BlockbenchTask } from "./blockbench-task"
import { createBlockbenchSession } from "./blockbench/session"
import { dispatchInternalMcp } from "./blockbench/mcp"
import { BlockbenchEnvelopeSchema } from "./blockbench/protocol"

// This isolated session is discarded after each transaction. The project is
// committed by the worker only after revision and asset validation succeeds.
export async function applyBlockbenchTransaction(runtime: { origin: string; url: string }, value: BlockbenchTask, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const task = BlockbenchTaskSchema.parse(value)
  const window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, partition: `minemods-model-${task.id}` } })
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, done) => done(false))
  window.webContents.session.setPermissionCheckHandler(() => false)
  window.webContents.session.webRequest.onBeforeRequest((details, done) => done({ cancel: !details.url.startsWith(runtime.origin + "/") && !/^(data|blob):/.test(details.url) }))
  const sessionId = randomUUID().replaceAll("-", "")
  const nonce = randomUUID().replaceAll("-", "")
  const source = new URL(runtime.url)
  source.searchParams.set("sessionId", sessionId)
  source.searchParams.set("nonce", nonce)
  source.searchParams.set("parentOrigin", runtime.origin)
  const cancel = () => { if (!window.isDestroyed()) window.destroy() }
  signal?.addEventListener("abort", cancel, { once: true })
  try {
    await window.loadURL(source.href)
    const deadline = Date.now() + 30000
    while (!await window.webContents.executeJavaScript("Boolean(window.Blockbench && window.Blockbench.setup_successful)")) {
      signal?.throwIfAborted()
      if (Date.now() >= deadline) throw new Error("Blockbench 本地内核启动超时。")
      await setTimeout(100)
    }
    const session = createBlockbenchSession({ projectId: task.projectId, assetId: task.entityId, sessionId, nonce, initialRevision: 0, transport: {
      request: async envelope => {
        // Only this fixed transport wrapper executes. Model content is parsed as
        // data, and the bridge accepts only its validated operation whitelist.
        const result: unknown = await window.webContents.executeJavaScript(`(() => {
          const request = JSON.parse(${JSON.stringify(JSON.stringify(envelope))});
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('Blockbench transaction timed out')); }, 15000);
            function receive(event) {
              const reply = event.data;
              if (event.source !== window || event.origin !== location.origin || !reply || reply.channel !== request.channel || reply.sessionId !== request.sessionId || reply.nonce !== request.nonce || reply.requestId !== request.requestId || reply.kind !== 'response') return;
              clearTimeout(timer); window.removeEventListener('message', receive); resolve(reply);
            }
            window.addEventListener('message', receive);
            window.postMessage(request, location.origin);
          });
        })()`)
        return BlockbenchEnvelopeSchema.parse(result)
      },
    } })
    await dispatchInternalMcp(session, { op: "open", model: task.model })
    signal?.throwIfAborted()
    return BoundedSnapshotSchema.parse((await dispatchInternalMcp(session, { op: "save" })).bbmodel)
  } finally {
    signal?.removeEventListener("abort", cancel)
    if (!window.isDestroyed()) window.destroy()
  }
}

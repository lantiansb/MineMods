import { createBlockbenchFrameAdapter, type BlockbenchFrameAdapter } from "./adapter"
import { createBlockbenchSession, type BlockbenchSession } from "../../main/blockbench/session"

export type MountedBlockbench = {
  iframe: HTMLIFrameElement
  adapter: BlockbenchFrameAdapter
  session: BlockbenchSession
  dispose: () => void
}

export function mountBlockbenchRuntime(options: {
  container: HTMLElement
  runtimeUrl: string
  origin: string
  projectId: string
  assetId: string
  initialRevision?: number
  title?: string
}): MountedBlockbench {
  const sessionId = crypto.randomUUID().replaceAll("-", "")
  const nonce = crypto.randomUUID().replaceAll("-", "")
  const runtimeUrl = new URL(options.runtimeUrl, window.location.href)
  runtimeUrl.searchParams.set("sessionId", sessionId)
  runtimeUrl.searchParams.set("nonce", nonce)
  runtimeUrl.searchParams.set("parentOrigin", window.location.origin === "null" ? "null" : window.location.origin)
  const iframe = document.createElement("iframe")
  iframe.title = options.title ?? "Blockbench model editor"
  iframe.src = runtimeUrl.toString()
  iframe.referrerPolicy = "no-referrer"
  iframe.setAttribute("aria-label", "Blockbench model editor")
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin")
  iframe.style.width = "100%"
  iframe.style.height = "100%"
  iframe.style.border = "0"
  options.container.replaceChildren(iframe)
  const adapter = createBlockbenchFrameAdapter({ iframe, origin: options.origin, sessionId, nonce })
  const session = createBlockbenchSession({
    projectId: options.projectId,
    assetId: options.assetId,
    initialRevision: options.initialRevision,
    sessionId: adapter.sessionId,
    nonce: adapter.nonce,
    transport: adapter,
  })
  return {
    iframe,
    adapter,
    session,
    dispose: () => {
      adapter.dispose()
      iframe.remove()
    },
  }
}

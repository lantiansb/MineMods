import { join, resolve } from "node:path"
export { createBlockbenchSession } from "./session"
export type { BlockbenchSession, BlockbenchTransport } from "./session"

export const BLOCKBENCH_VERSION = "5.1.6"
export const BLOCKBENCH_COMMIT = "794e964e966b6783b4e9b98ecbdda5152c0620cc"

export type BlockbenchRuntimeDescriptor = {
  version: string
  commit: string
  root: string
  entry: string
  origin: string
  csp: string
  allowedPathPrefix: string
}

export function describeBlockbenchRuntime(vendorRoot: string, origin = "http://127.0.0.1:41773") {
  const root = resolve(vendorRoot)
  return {
    version: BLOCKBENCH_VERSION,
    commit: BLOCKBENCH_COMMIT,
    root,
    entry: join(root, "index.html"),
    origin,
    allowedPathPrefix: "/blockbench/",
    csp: [
      "default-src 'self'",
      // Blockbench 5.1.6 ships Vue's runtime template compiler. Its trusted
      // local bundle needs eval to compile its own templates; message payloads
      // never reach eval and the bridge has no dynamic-code path.
      "script-src 'self' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'self' file: http://127.0.0.1:*",
    ].join("; "),
  } satisfies BlockbenchRuntimeDescriptor
}

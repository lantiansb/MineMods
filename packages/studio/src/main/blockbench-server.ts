import { createServer } from "node:http"
import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { BLOCKBENCH_VERSION, describeBlockbenchRuntime } from "./blockbench/runtime"

export async function startBlockbenchServer(directory: string) {
  const root = await realpath(directory)
  const prefix = `/${randomUUID()}`
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".webp": "image/webp" }
  const server = createServer((request, response) => {
    const serve = async () => {
      const url = new URL(request.url ?? "/", "http://localhost")
      const pathname = decodeURIComponent(url.pathname)
      if (!pathname.startsWith(prefix + "/")) { response.writeHead(404); response.end(); return }
      const relative = pathname.slice(prefix.length + 1) || "index.html"
      const target = path.resolve(root, relative)
      if (!target.startsWith(root + path.sep)) { response.writeHead(404); response.end(); return }
      const canonical = await realpath(target)
      if (!canonical.startsWith(root + path.sep) || !(await stat(canonical)).isFile()) { response.writeHead(404); response.end(); return }
      const bytes = await readFile(canonical)
      response.writeHead(200, { "Content-Type": types[path.extname(canonical)] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": describeBlockbenchRuntime(root).csp, "Cache-Control": "no-store" })
      response.end(bytes)
    }
    void serve().catch(() => { if (!response.headersSent) response.writeHead(404); response.end() })
  })
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()) })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Blockbench runtime address is unavailable")
  const origin = `http://127.0.0.1:${address.port}`
  return { origin, url: `${origin}${prefix}/index.html`, version: BLOCKBENCH_VERSION, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

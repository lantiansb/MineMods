import { createServer } from "node:http"
import { createModelingHandler } from "./route"

export async function startModelingServer(options: { port?: number; serviceToken?: string } = {}) {
  const port = options.port ?? 4319
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("INVALID_SERVICE_PORT")
  const handler = createModelingHandler({ serviceToken: options.serviceToken ?? process.env.STUDIO_SERVICE_TOKEN })
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 180000 }, (incoming, outgoing) => {
    const cancellation = new AbortController()
    incoming.on("aborted", () => cancellation.abort())
    outgoing.on("close", () => {
      if (!outgoing.writableEnded) cancellation.abort()
    })
    const handle = async () => {
      const chunks: Buffer[] = []
      for await (const chunk of incoming) {
        chunks.push(Buffer.from(chunk))
        if (chunks.reduce((total, item) => total + item.byteLength, 0) > 65536) {
          outgoing.writeHead(413, { "Content-Type": "application/json", "Cache-Control": "no-store" })
          outgoing.end('{"error":{"code":"INVALID_INPUT"}}')
          return
        }
      }
      const response = await handler(
        new Request(new URL(incoming.url ?? "/", "http://127.0.0.1"), {
          method: incoming.method,
          headers: {
            authorization: incoming.headers.authorization ?? "",
            "content-type": incoming.headers["content-type"] ?? "",
            "content-length": incoming.headers["content-length"] ?? "0",
          },
          body:
            incoming.method === "GET" || incoming.method === "HEAD"
              ? undefined
              : Buffer.concat(chunks).toString("utf8"),
          signal: cancellation.signal,
        }),
      )
      response.headers.forEach((value, name) => outgoing.setHeader(name, value))
      outgoing.writeHead(response.status)
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    }
    void handle().catch(() => {
      if (outgoing.destroyed || outgoing.writableEnded) return
      outgoing.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" })
      outgoing.end('{"error":{"code":"SERVICE_UNAVAILABLE"}}')
    })
  })
  server.headersTimeout = 15000
  return new Promise<typeof server>((resolve, reject) => {
    const fail = () => reject(new Error("SERVICE_START_FAILED"))
    server.once("error", fail)
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", fail)
      resolve(server)
    })
  })
}

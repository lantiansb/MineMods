import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici"

export function createTimedModelingTransport() {
  const agent = new Agent({ headersTimeout: 600_000, bodyTimeout: 600_000, keepAliveTimeout: 4_000 })
  return {
    fetch: (url: string, init: RequestInit) => undiciFetch(url, { ...init, dispatcher: agent } as unknown as UndiciRequestInit) as unknown as Promise<Response>,
    close: () => agent.close(),
  }
}

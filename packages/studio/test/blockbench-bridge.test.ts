import { describe, expect, test } from "bun:test"
import { createBlockbenchSession } from "../src/main/blockbench/session"
import { describeBlockbenchRuntime } from "../src/main/blockbench/runtime"
import { parseBlockbenchEnvelope } from "../src/main/blockbench/ipc"

const snapshot = { revision: 1, project: { name: "smoke" }, bbmodel: { meta: { format_version: "5.0" } } }

describe("Blockbench bridge contract", () => {
  test("rejects a message from a different origin or session", () => {
    expect(() => parseBlockbenchEnvelope({ channel: "minemods:blockbench:v1", nonce: "Nonce_123456789012", sessionId: "Session_123456789012", requestId: "Request_123456789012", kind: "request", command: { op: "readSnapshot" } }, "https://evil.invalid", { origin: "http://127.0.0.1:41773", nonce: "Nonce_123456789012", sessionId: "Session_123456789012" })).toThrow("origin")
  })

  test("keeps revision conflicts at the session boundary", async () => {
    const session = createBlockbenchSession({ projectId: "project", assetId: "asset", transport: { request: async (envelope) => ({ ...envelope, kind: "response", ok: true, revision: 1, snapshot }) } })
    await session.request({ op: "readSnapshot" })
    expect(session.revision).toBe(1)
    expect(session.request({ op: "readSnapshot" }, 0)).rejects.toThrow("revision conflict")
  })

  test("describes a local only runtime", () => {
    const descriptor = describeBlockbenchRuntime("C:/MineMods/vendor/blockbench/runtime")
    expect(descriptor.version).toBe("5.1.6")
    expect(descriptor.csp).toContain("connect-src 'none'")
    expect(descriptor.csp).toContain("frame-ancestors 'self' file:")
  })

  test("rejects malformed snapshots and cross-session responses without advancing revision", async () => {
    const invalid = createBlockbenchSession({ projectId: "project", assetId: "asset", transport: { request: async envelope => ({ ...envelope, kind: "response", ok: true, revision: 1, snapshot: {} }) } })
    await expect(invalid.request({ op: "readSnapshot" })).rejects.toThrow()
    expect(invalid.revision).toBe(0)
    const other = createBlockbenchSession({ projectId: "project", assetId: "asset", transport: { request: async envelope => ({ ...envelope, nonce: "AnotherNonce123456789", kind: "response", ok: true, revision: 1, snapshot }) } })
    await expect(other.request({ op: "readSnapshot" })).rejects.toThrow("Invalid Blockbench response")
    expect(other.revision).toBe(0)
  })
})

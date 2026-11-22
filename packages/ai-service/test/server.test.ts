import { expect, test } from "bun:test"
import { startModelingServer } from "../src/server"

test("Node-compatible service binds loopback and serves authenticated modeling route", async () => {
  const server = await startModelingServer({ port: 0, serviceToken: "developer-token" })
  const address = server.address()
  expect(address && typeof address !== "string" && address.address).toBe("127.0.0.1")
  if (!address || typeof address === "string") throw new Error("Expected TCP address")
  const result = await fetch(`http://127.0.0.1:${address.port}/v1/modeling`, { method: "POST", body: "{}" })
  expect(result.status).toBe(401)
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

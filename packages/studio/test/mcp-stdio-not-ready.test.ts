import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import os from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { createExternalMcpBridge } from "../src/main/external-mcp"
import { STUDIO_UNREACHABLE } from "../src/main/mcp-stdio"

/**
 * r29g (公开仓库的第一步): an AI client started before Studio is ready (Studio closed, the descriptor left by a Studio that has quit, or Studio not
 * accepting outside AI yet) used to see only "connection closed": the stdio bridge threw before the MCP handshake. It now completes the handshake,
 * says why in its instructions, and answers every tool call with the same words, so the AI can tell the person what to do.
 */
const roots: string[] = []
const transports: StdioClientTransport[] = []
const bridges: ReturnType<typeof createExternalMcpBridge>[] = []
afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close().catch(() => undefined)))
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

// The bridge runs from its source under Bun: no bundle (a second Bun.build in the one process the whole suite runs in read the sources at the same time as
// external-mcp.test's and failed).
async function compiled() {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-mcp-not-ready-"))
  roots.push(root)
  return { root, script: path.resolve(import.meta.dir, "../src/main/mcp-stdio.ts") }
}

async function connect(script: string, descriptorPath: string) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [script, "--mcp-stdio", "--connection", descriptorPath], stderr: "pipe" })
  transports.push(transport)
  const client = new Client({ name: "not-ready-test", version: "0.1.0" })
  await client.connect(transport)
  return client
}

const said = (result: unknown) => JSON.stringify(result)

test("Studio not accepting outside AI: the handshake completes, the instructions and the tool call say what the person is to do", async () => {
  const { root, script } = await compiled()
  const refusal = "MineMods Studio 还没有接受外部 AI。请用户点击 Studio 顶栏的 AI 连接状态，选「用我自己的 AI 助手」，按三步向导接上后再试。"
  const bridge = createExternalMcpBridge({ token: "n".repeat(32), call: async () => { throw new Error(refusal) } })
  bridges.push(bridge)
  const descriptorPath = path.join(root, "connection.json")
  await Bun.write(descriptorPath, JSON.stringify(await bridge.start()))
  const client = await connect(script, descriptorPath)
  expect(client.getInstructions()).toContain("【现在还用不了 MineMods Studio】")
  expect(client.getInstructions()).toContain("用我自己的 AI 助手")
  const answer = await client.callTool({ name: "list_projects", arguments: {} })
  expect(answer.isError).toBe(true)
  expect(said(answer)).toContain("用我自己的 AI 助手")
}, 120000)

test("nothing listening at the descriptor's address (Studio closed, or the one that wrote it has quit): the call says so in words", async () => {
  const { root, script } = await compiled()
  // A port that was free a moment ago and is closed again: nothing answers there.
  const port = await new Promise<number>((resolve) => { const server = createServer().listen(0, "127.0.0.1", () => { const value = (server.address() as { port: number }).port; server.close(() => resolve(value)) }) })
  const descriptorPath = path.join(root, "connection.json")
  await Bun.write(descriptorPath, JSON.stringify({ url: `http://127.0.0.1:${port}/mcp`, token: "d".repeat(32) }))
  const client = await connect(script, descriptorPath)
  expect(client.getInstructions()).toContain(STUDIO_UNREACHABLE)
  const answer = await client.callTool({ name: "list_projects", arguments: {} })
  expect(answer.isError).toBe(true)
  expect(said(answer)).toContain("连不上 MineMods Studio")
}, 120000)

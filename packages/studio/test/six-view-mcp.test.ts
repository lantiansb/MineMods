import { expect, test } from "bun:test"
import { REFERENCE_LIMITS, THREE_VIEW_NOTE } from "@minemods/studio-ai/making"
import { ExternalThreeViewFinishInputSchema, ExternalThreeViewPromptInputSchema } from "../src/external"
import { bodyLimit, createExternalMcpBridge } from "../src/main/external-mcp"

const item = { projectId: "11111111-1111-4111-8111-111111111111", itemId: "model_current" }
const image = "data:image/png;base64,aGVsbG8="

test("六视图协议仅收当前资产、严格单图 data URL 或明确不具备能力", () => {
  expect(ExternalThreeViewPromptInputSchema.parse({ ...item, note: "剑柄" })).toEqual({ ...item, note: "剑柄" })
  expect(ExternalThreeViewPromptInputSchema.safeParse({ ...item, note: "字".repeat(THREE_VIEW_NOTE + 1) }).success).toBe(false)
  expect(ExternalThreeViewPromptInputSchema.safeParse({ ...item, itemId: "x".repeat(201) }).success).toBe(false)
  expect(ExternalThreeViewPromptInputSchema.safeParse({ ...item, projectId: "not-uuid" }).success).toBe(false)
  const generated = (value: string) => ({ ...item, result: { status: "generated", image: value } })
  expect(ExternalThreeViewFinishInputSchema.safeParse(generated(image)).success).toBe(true)
  for (const value of ["C:/picture.png", "file:///picture.png", "https://example.com/picture.png", "data:image/svg+xml;base64,aGVsbG8=", "data:image/png;base64,", "data:image/png;base64,AAAAA", "data:image/png;base64,!!!!"])
    expect(ExternalThreeViewFinishInputSchema.safeParse(generated(value)).success).toBe(false)
  const largest = `data:image/webp;base64,${Buffer.alloc(REFERENCE_LIMITS.bytes).toString("base64")}`
  expect(ExternalThreeViewFinishInputSchema.safeParse(generated(largest)).success).toBe(true)
  expect(ExternalThreeViewFinishInputSchema.safeParse(generated(`data:image/webp;base64,${Buffer.alloc(REFERENCE_LIMITS.bytes + 1).toString("base64")}`)).success).toBe(false)
  expect(ExternalThreeViewFinishInputSchema.safeParse({ ...item, result: { status: "unsupported", reason: "当前会话没有绘图工具，需要独立准备。" } }).success).toBe(true)
  expect(ExternalThreeViewFinishInputSchema.safeParse({ ...item, result: { status: "unsupported", reason: " " } }).success).toBe(false)
  expect(ExternalThreeViewFinishInputSchema.safeParse({ ...item, result: { status: "unsupported", reason: "x".repeat(2001) } }).success).toBe(false)
  expect(ExternalThreeViewFinishInputSchema.safeParse({ ...item, result: { status: "unsupported", reason: "没有工具", image } }).success).toBe(false)
  expect(ExternalThreeViewFinishInputSchema.safeParse({ ...generated(image), path: "C:/picture.png" }).success).toBe(false)
})

test("六视图 bridge 允许单张最大图，专用上限和鉴权继续生效", async () => {
  const calls: string[] = []
  const bridge = createExternalMcpBridge({ token: "v".repeat(32), call: async (method) => (calls.push(method), { accepted: true }) })
  const descriptor = await bridge.start()
  const post = (input: unknown, token = descriptor.token) => fetch(descriptor.url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ method: "finishThreeView", input }) })
  try {
    const largest = `data:image/webp;base64,${Buffer.alloc(REFERENCE_LIMITS.bytes).toString("base64")}`
    expect((await post({ ...item, result: { status: "generated", image: largest } })).status).toBe(200)
    expect((await (await post({ ...item, result: { status: "generated", image: "A".repeat(bodyLimit("finishThreeView")) } })).json())).toMatchObject({ ok: false, error: expect.stringContaining("六视图只收一张") })
    expect((await (await post({ ...item, result: { status: "unsupported", reason: "没有工具" } }, "w".repeat(32))).json())).toMatchObject({ ok: false, error: expect.stringContaining("token 无效") })
    expect(calls).toEqual(["finishThreeView"])
  } finally {
    await bridge.stop()
  }
})

import { expect, test } from "bun:test"
import { ExternalAwaitInspectionInputSchema, ExternalNextInspectionInputSchema, INSPECTION_LIMITS } from "../src/external"
import { MCP_TOOLS } from "../src/main/mcp-handoff"

// 主工程第 17 条：await_inspection 一次最多等的秒数放宽到 300 秒，默认还是 40 秒；说明里写清楚什么时候才写大的。

const task = { projectId: crypto.randomUUID(), runId: crypto.randomUUID(), taskId: crypto.randomUUID() }

test("await_inspection 的 wait_seconds 最多 300 秒，不写照旧是 40 秒；next_inspection 不变", () => {
  expect(INSPECTION_LIMITS.wait).toBe(40)
  expect(INSPECTION_LIMITS.longest).toBe(300)
  expect(ExternalAwaitInspectionInputSchema.safeParse({ ...task, wait_seconds: 300 }).success).toBe(true)
  expect(ExternalAwaitInspectionInputSchema.safeParse({ ...task, wait_seconds: 301 }).success).toBe(false)
  expect(ExternalNextInspectionInputSchema.safeParse({ projectId: task.projectId, wait_seconds: 41 }).success).toBe(false)
})

test("工具说明讲清默认几秒、最多几秒，客户端时限只有一分钟时不要写大的", () => {
  const words = MCP_TOOLS.find((tool) => tool[0] === "await_inspection")![1]
  expect(words).toContain("不写是 40 秒，最多可写 300 秒（5 分钟）")
  expect(words).toContain("时限是默认一分钟的就不写或写 40 以内")
})

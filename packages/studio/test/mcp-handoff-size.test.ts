import { expect, test } from "bun:test"
import { STANDARD_SUMMARY } from "@minemods/mod-core/acceptance"
import { MODEL_ART_DIRECTION } from "@minemods/studio-ai/model-quality"
import { MAKING_DISCIPLINE } from "@minemods/studio-ai/making"
import { SCRIPT_GUIDE } from "@minemods/studio-ai/script"
import { buildMcpHandoff, MCP_SERVER_INSTRUCTIONS, MCP_TOOLS } from "../src/main/mcp-handoff"
import { CONFIGURATION, PROJECT } from "./handoff-reading"

const withoutCode = (text: string) => text.replace(/```[a-z]*\n[\s\S]*?\n```/g, "")

test("起步说明：有真实长度的配置和工程，也在 5000 字以内；除去配置和工程数据，文字约 3000 字", () => {
  for (const review of [true, false, undefined]) {
    const start = buildMcpHandoff({ configuration: CONFIGURATION, project: PROJECT, review })
    expect(start.length).toBeLessThanOrEqual(5000)
    expect(withoutCode(start).length).toBeLessThanOrEqual(3300)
  }
  // It was 90,000 characters: nothing of the long parts is copied any more.
  const start = buildMcpHandoff({ configuration: CONFIGURATION, project: PROJECT, review: true })
  for (const long of [MAKING_DISCIPLINE, SCRIPT_GUIDE, MODEL_ART_DIRECTION, STANDARD_SUMMARY, MCP_TOOLS[0]![1], "| 工具 | 参数契约 | 用途 |", "## 16 个模块职责"]) expect(start).not.toContain(long)
  expect(start).not.toContain(MCP_SERVER_INSTRUCTIONS)
})

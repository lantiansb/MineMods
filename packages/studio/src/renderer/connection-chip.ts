import type { McpConnectionStatus } from "../mcp-status"
import { MCP_PRESENCE } from "../mcp-presence"

/**
 * How long after its last tool call an outside AI still counts as there. The bridge itself reports `connected`
 * only for 30 s after a call, but calls are separate events: between two of them the client is reading, thinking
 * or waiting for the person, and that commonly takes longer than 30 s (a real run showed 「AI 没连接」 while the
 * client was at work). Two minutes covers a long pause between calls of one session and is still short enough
 * that a client that was closed stops being shown as there soon after.
 */
export const OUTSIDE_PRESENT_MS = MCP_PRESENCE.legacy

/** An outside AI is there: the bridge has it connected now, or it called a tool within `OUTSIDE_PRESENT_MS`. */
export function outsidePresent(status: Pick<McpConnectionStatus, "connected" | "lastActivity" | "state"> | undefined, now: number) {
  if (!status) return false
  if (status.state) return status.connected
  if (status.connected) return true
  const last = status.lastActivity ? Date.parse(status.lastActivity) : Number.NaN
  return Number.isFinite(last) && now - last >= 0 && now - last < OUTSIDE_PRESENT_MS
}

export const CHIP_WORDS = { outside_on: "已连接", outside_off: "AI 没连接", own_on: "已连接", own_off: "AI 没连接" } as const

/** The title bar's connection chip. How the connection is made (MCP, API) is named only under 高级. */
export function connectionChip(input: { external: boolean; mcp: Pick<McpConnectionStatus, "connected" | "lastActivity" | "state"> | undefined; aiConfigured: boolean; advanced: boolean; now: number }) {
  const on = input.external ? outsidePresent(input.mcp, input.now) : input.aiConfigured
  const state = input.external ? input.mcp?.state ?? (on ? "connected" : "unconnected") : on ? "connected" : "unconnected"
  const words = { connected: "已连接", working: "正在做", idle: "45 秒没动静", disconnected: "断开了", unconnected: "AI 没连接" }[state]
  return { on, state, text: input.advanced && (input.external || on) ? `${words} · ${input.external ? "MCP" : "API"}` : words }
}

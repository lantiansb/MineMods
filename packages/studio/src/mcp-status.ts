import type { PresenceSnapshot } from "./mcp-presence"
export type McpConnectionStatus = Partial<PresenceSnapshot> & {
  enabled: boolean
  connected: boolean
  clients: number
  lastActivity: string | null
  configuration: string
  /** The same entry as a Codex `config.toml` table, for the manual way. Absent: an older main process. */
  codexConfiguration?: string
  /** The newest project an outside AI created in this session (when, as an ISO time), so the window can open it or offer to. Absent: none, or an older main process. */
  madeProject?: { id: string; name: string; at: string } | null
}

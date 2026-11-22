/** Timing shared by the stdio reporter, host and renderer. Heartbeats never count as work. */
export const MCP_PRESENCE = { report: 2_000, missed: 3, idle: 45_000, legacy: 120_000, watch: 250, restored: 4_000 } as const
export type PresenceState = "unconnected" | "connected" | "working" | "idle" | "disconnected"
export type PresenceSnapshot = {
  state: PresenceState
  connected: boolean
  clients: number
  lastHeartbeat: number | null
  connectedAt: number | null
  lastTool: number | null
  tools: number
  task: string | null
  modern: boolean
}

/** A lost modern session is latched until a successful new report, even if a late tool arrives. */
export function createPresence(options: { now?: () => number; alive?: (pid: number) => boolean } = {}) {
  const now = options.now ?? Date.now
  const sessions = new Map<string, { modern: boolean; pid?: number; at: number; since: number; tool: number; tools: number; tasks: Map<string, { title: string; runId?: string }>; lost: boolean; lostAt?: number }>()
  let legacyAt: number | null = null
  let legacyTools = 0
  let legacyClosed = false
  return {
    report(input: { sessionId: string; presenceVersion?: number; pid?: number; shutdown?: boolean }) {
      const old = sessions.get(input.sessionId)
      if (input.shutdown) {
        if (old && !old.lost) Object.assign(old, { lost: true, lostAt: now() })
        if (!old?.modern) legacyClosed = true
        return
      }
      sessions.set(input.sessionId, {
        modern: input.presenceVersion === 1, pid: input.pid, at: now(),
        since: old && !old.lost ? old.since : now(), tool: old?.tool ?? now(), tools: old?.tools ?? 0,
        tasks: old?.tasks ?? new Map(), lost: false,
      })
      legacyClosed = false
    },
    tool(sessionId?: string) {
      const session = sessionId ? sessions.get(sessionId) : undefined
      if (session) { session.tool = now(); session.tools += 1; return }
      // A new v1 process identifies its calls before its first report; those cannot restore an old session.
      if (sessionId) return
      legacyAt = now()
      legacyTools += 1
      legacyClosed = false
    },
    task(sessionId: string | undefined, id: string, title: string | null, runId?: string) {
      const session = sessionId ? sessions.get(sessionId) : undefined
      if (!session) return
      // A task goes with whoever works on it now: a new conversation taking it over takes it from the one that left.
      sessions.forEach((other) => other !== session && other.tasks.delete(id))
      if (title === null) { session.tasks.delete(id); return }
      session.tasks.set(id, { title, runId })
      session.tool = now()
    },
    cancel(runId: string) {
      sessions.forEach((s) => s.tasks.forEach((task, id) => { if (task.runId === runId) s.tasks.delete(id) }))
    },
    snapshot(): PresenceSnapshot {
      const time = now()
      sessions.forEach((session) => {
        if (!session.lost && session.modern && (time - session.at >= MCP_PRESENCE.report * MCP_PRESENCE.missed || (session.pid && options.alive && !options.alive(session.pid)))) Object.assign(session, { lost: true, lostAt: time })
      })
      const active = [...sessions.values()].filter((s) => !s.lost && time - s.at < (s.modern ? MCP_PRESENCE.report * MCP_PRESENCE.missed : MCP_PRESENCE.legacy))
      const selected = active.filter((s) => s.tasks.size).sort((a, b) => b.tool - a.tool)[0] ?? active.at(-1) ?? [...sessions.values()].at(-1)
      const modern = [...sessions.values()].some((s) => s.modern)
      const connected = active.length > 0 || (!legacyClosed && legacyAt !== null && time - legacyAt < MCP_PRESENCE.legacy)
      const working = selected ? [...selected.tasks.values()].at(-1)?.title ?? null : null
      // Tasks held by a session that left after everyone still here had connected, and nobody connected holding any: the AI making things is gone, though a reviewer
      // may still wait. A session that connected after it left is that AI back (a new process, a new conversation), and it goes on with the tasks.
      const left = working ? null : [...sessions.values()].filter((s) => s.lost && s.tasks.size && active.every((other) => other.since < (s.lostAt ?? 0))).flatMap((s) => [...s.tasks.values()]).at(-1)?.title ?? null
      const task = working ?? left
      return {
        state: !connected || left ? (sessions.size || legacyAt !== null ? "disconnected" : "unconnected") : task ? (time - selected!.tool >= MCP_PRESENCE.idle ? "idle" : "working") : "connected",
        connected, clients: active.length || (connected ? 1 : 0), lastHeartbeat: selected?.at ?? legacyAt,
        connectedAt: selected?.since ?? legacyAt, lastTool: selected?.tool ?? legacyAt,
        tools: [...sessions.values()].reduce((count, s) => count + s.tools, legacyTools), task, modern,
      }
    },
  }
}

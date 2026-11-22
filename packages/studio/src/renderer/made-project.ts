import type { McpConnectionStatus } from "../mcp-status"

/**
 * An outside AI made a project while the person was looking at the window. What the window does about it is decided here, pure, so it can be checked without a screen.
 *
 * The person asked their AI for a project and is waiting for it, so the project must not stay hidden behind a home page they have to go and look at.
 * But a window is not theirs to take over while they are in the middle of something: an open project, a typed project name, unsaved edits and a running
 * step are all work in flight, and switching under it would lose or hide it. So: nothing in flight, the project opens; anything in flight, a bar says
 * what happened and one press opens it (asking first when something is unsaved, like every other way of opening a project).
 */

/** The pages that hold nothing a switch could cost: the project list, the settings (every setting there is saved by its own button) and the storage page. */
const IDLE_PAGES: readonly string[] = ["home", "profile", "resources"]

/** How long a project counts as "just made". Longer ago (the window was reloaded, or only now looked at the connection) it is an old fact, not news. */
export const MADE_FRESH_MS = 5 * 60_000

export const MADE_WORDS = {
  said: (name: string) => `AI 建好了「${name}」`,
  open: "点这里打开",
  dismiss: "先不看",
  unsaved: "打开 AI 新建的工程，这里没保存的修改就没有了。",
} as const

export type MadeProject = NonNullable<McpConnectionStatus["madeProject"]>

/** The project the status names, when it is news: made within `MADE_FRESH_MS` and not the one already dealt with. */
export function freshMade(status: Pick<McpConnectionStatus, "madeProject"> | undefined, now: number, handled: string): MadeProject | null {
  const made = status?.madeProject
  if (!made) return null
  if (`${made.id}@${made.at}` === handled) return null
  const at = Date.parse(made.at)
  return Number.isFinite(at) && now - at < MADE_FRESH_MS ? made : null
}

/** The key a project made is remembered by once dealt with, so the next poll of the same fact does nothing. */
export const madeKey = (made: MadeProject) => `${made.id}@${made.at}`

/** "open": the window goes to the project at once. "offer": the bar is shown. */
export function followMade(input: { page: string; unsaved: boolean; working: boolean }): "open" | "offer" {
  return IDLE_PAGES.includes(input.page) && !input.unsaved && !input.working ? "open" : "offer"
}

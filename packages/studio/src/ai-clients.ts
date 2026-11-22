/**
 * 一键接上 (broad20, round 22): the AI assistants this computer may already have, and the words for connecting Studio to them.
 *
 * Shared by the main process (which looks at the disk and writes the settings file) and the window (which only shows buttons and words).
 * Nothing here touches the disk, so the window may import it.
 */

export const AI_CLIENT_IDS = ["claude-desktop", "codex"] as const
export type AiClientId = (typeof AI_CLIENT_IDS)[number]

/**
 * Where Studio stands in one assistant's settings:
 * absent = Studio is not in it yet; current = it is there exactly as Studio would write it today;
 * outdated = it is there but differs (Studio was moved or updated since); unreadable = the settings file cannot be understood, so it is left alone.
 */
export type ConnectState = "absent" | "current" | "outdated" | "unreadable"

export type AiClientInfo = { id: AiClientId; installed: boolean; state: ConnectState; files?: readonly string[] }
export type AiClientDetection = { clients: AiClientInfo[] }

export type ConnectProblem =
  /** The settings file is not valid JSON/TOML, so it was not touched. */
  | "unreadable"
  /** Valid, but laid out in a way a merge cannot be trusted with (the part for Studio is not where it should be), so it was not touched. */
  | "unusual"
  /** The file could not be read, backed up or written (in use by another program, no permission…). */
  | "no-access"
  /** What was written did not read back the same. */
  | "mismatch"
  | "not-installed"

export type ConnectedFile = { path: string; backup: string | null; change: "added" | "updated" | "unchanged" }
export type ConnectResult =
  | { ok: true; client: AiClientId; files: ConnectedFile[] }
  | { ok: false; client: AiClientId; problem: ConnectProblem; path: string; backup: string | null; detail?: string }

/** The two fixed pages the window may ask Studio to open; the window names the assistant, never a link. */
export const AI_CLIENT_DOWNLOAD: Record<AiClientId, string> = {
  "claude-desktop": "https://claude.com/download",
  codex: "https://developers.openai.com/codex",
}

export const AI_CLIENT_NAME: Record<AiClientId, string> = { "claude-desktop": "Claude 桌面版", codex: "Codex" }

/** What the person must do for the assistant to pick the new setting up: it reads its settings only when it starts. */
const RESTART: Record<AiClientId, string> = {
  "claude-desktop": "请完全退出 Claude 桌面版再重新打开（只关窗口不一定退出）",
  codex: "请退出并重新打开 Codex（命令行版就重新运行一次）",
}

export const CONNECT_WORDS = {
  title: "把 Studio 接到你的 AI 助手",
  detect: "重新检测",
  detecting: "正在看这台电脑上有没有……",
  working: "正在接上……",
  /** Nothing found. Free accounts do work; whether a whole mod fits in one day's allowance is not promised. */
  install: "这台电脑上还没找到 Claude 桌面版或 Codex。先装一个，装好以后回到这里点「重新检测」，再点「接上」。",
  quota: "免费账号也能用，但做完整个模组可能会用完当天的额度。",
  advanced: "已经装了却没找到，可以用下面的「手动接入」。",
} as const

const HINT: Record<ConnectState, string | null> = {
  absent: null,
  current: "之前已经接过，位置没变；想再写一遍也可以。",
  outdated: "之前接过，但 Studio 的位置变了，点一下更新。",
  unreadable: "它的设置文件读不懂，Studio 不会去改它。",
}

export type ConnectButton = {
  client: AiClientId
  label: string
  /** One line under the button; null when there is nothing to add. */
  hint: string | null
  disabled: boolean
  primary: boolean
}

/**
 * What the 「接上」 area shows for what was found: a button for each assistant that is on this computer (the first one is the main button),
 * or, with none, where to get them. A button whose settings file cannot be understood is shown, with the reason, but cannot be pressed.
 */
export function connectChoices(detection: AiClientDetection | null) {
  const found = (detection?.clients ?? []).filter((client) => client.installed)
  if (!detection) return { kind: "looking" as const, buttons: [] as ConnectButton[], downloads: [] as { client: AiClientId; label: string }[] }
  if (!found.length)
    return {
      kind: "install" as const,
      buttons: [] as ConnectButton[],
      downloads: AI_CLIENT_IDS.map((client) => ({ client, label: `下载 ${AI_CLIENT_NAME[client]}` })),
    }
  const buttons = found.map((client, index): ConnectButton => ({
    client: client.id,
    label: `接到 ${AI_CLIENT_NAME[client.id]}`,
    hint: HINT[client.state],
    disabled: client.state === "unreadable",
    primary: index === 0,
  }))
  return { kind: "connect" as const, buttons, downloads: [] as { client: AiClientId; label: string }[] }
}

/** The words after pressing a button. Not-yet-restarted is the usual outcome, so it is always said with what was written. */
export function connectedLine(result: ConnectResult) {
  const name = AI_CLIENT_NAME[result.client]
  if (!result.ok) return problemLine(result.client, result.problem)
  if (result.files.every((file) => file.change === "unchanged"))
    return `${name} 里本来就是这样，没有改动。如果它还没认出来，${RESTART[result.client]}，再新开一个对话。`
  return `已接到 ${name}。${RESTART[result.client]}，然后在里面新开一个对话，粘贴下面的起步说明。`
}

export function problemLine(client: AiClientId, problem: ConnectProblem) {
  const name = AI_CLIENT_NAME[client]
  switch (problem) {
    case "unreadable":
      return `${name} 的设置文件读不懂，Studio 没有改动它。请先修好它，或使用下面的「手动接入」。`
    case "unusual":
      return `${name} 的设置文件写法比较特别，Studio 没有改动它。请用下面的「手动接入」。`
    case "no-access":
      return `没能写进 ${name} 的设置（可能被别的程序占着，或者没有权限），原来的文件没有被改动。`
    case "mismatch":
      return `写进 ${name} 的设置以后读回来对不上。原来的文件已经备份在同一个文件夹里，请检查一下。`
    case "not-installed":
      return `没有找到 ${name}。`
  }
}

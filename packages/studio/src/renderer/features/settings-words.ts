import { MODE_WORDS } from "../words"

/**
 * Words for 个人设置 and its 连接 AI area (broad20, round 20): where the person came from, what is chosen against what is in
 * force, and what the review switch asks of them. Plain functions so what the window says is tested without drawing it.
 */

export type AiMode = "api" | "mcp"

/** The pages that are not a project's own: with these on screen no project is "open", though one may still be loaded. */
const NOT_A_PROJECT = ["home", "profile", "create", "resources"]

/**
 * Where 个人设置 was entered from: the project that was on screen the moment it was opened, else nothing (the home page, the
 * create page…). The loaded project alone does not say so: it stays loaded after the person goes home, and then 「返回工程」
 * would take them somewhere they were not.
 */
export function settingsOrigin<T>(input: { previousPage: string | undefined; project: T | null | undefined }): T | null {
  if (!input.project || !input.previousPage || NOT_A_PROJECT.includes(input.previousPage)) return null
  return input.project
}

/** A name on a button: long ones are cut so the button does not push the rest of the heading away; the sentence beside it has the whole name. */
const briefly = (name: string) => (Array.from(name).length > 14 ? `${Array.from(name).slice(0, 14).join("")}…` : name)

/** The way back from 个人设置 and the words on it: the project it came from by name, else the project library. */
export function settingsBack(origin: { name: string } | null) {
  return origin
    ? { label: `返回工程「${briefly(origin.name)}」`, to: "overview" as const, said: `你是从工程「${origin.name}」来的，它还开着，没有丢；改完设置点右边的按钮就回去。` }
    : { label: "回工程库", to: "home" as const, said: "" }
}

/**
 * The title bar's line when no project's page is on screen. A project that is still loaded is said to be there (the worry
 * is "did the one I just made go away?"); only with none loaded is it 「还没打开工程」.
 */
export function awayStatus(input: { project?: string | null; nickname: string }) {
  const project = input.project?.trim()
  if (project) return `工程「${project}」`
  return input.nickname ? `你好，${input.nickname}` : "还没打开工程"
}

/**
 * The line over the 连接 AI area. 「现在用的是」 is only for what is in force; a choice that is made but not carried out yet
 * (the outside AI picked, its instructions not yet copied; or the other way round) is said as a choice with the step that is left.
 */
export function connectionLine(input: { saved: AiMode; picked: AiMode }) {
  if (input.saved === input.picked) return { pending: false, text: `现在用的是：${MODE_WORDS[input.saved].short}` }
  const left = input.picked === "mcp" ? "还差一步：把起步说明复制给它" : "还差几步：填好密钥并验证"
  return { pending: true, text: `你选了：${MODE_WORDS[input.picked].short}（${left}）` }
}

/**
 * What stands under the 「审查」 switch when the AI is the person's own. On, a second AI conversation is needed and the person is told
 * so here, before the second copy asks for it; off, the one that makes the thing checks its own work, which is said to be worth less.
 * The second conversation is a window of its own by the product's rule that a review is never done by the one who made the thing.
 */
export const REVIEW_OUTSIDE = {
  on: "开着：要再开一个 AI 对话来当审查员（下面有给它的那份说明）。不想开就关掉，关了由做东西的 AI 自己检查，可信度会低一些。",
  off: "关着：只需要一份说明。做东西的 AI 自己检查自己做的东西，可信度比另请审查员低一些。",
  card: "在同一个 AI 助手里再新开一个对话（不用再接一次），把这一份粘贴进去：它只看、只挑毛病，不改任何东西。不这样做，做好的东西会停在「等审查员」。",
} as const

/** How long 「已复制」 stays on a copy button before it can be pressed as a plain copy again (the same hold the outside AI's workbench gives its copy lines). */
export const COPIED_HOLD_MS = 3000

/**
 * The words on the button that copies the hand-off. 「再次」 is only said of a copy this visit really made: connecting Studio to the assistant
 * enables the outside AI without copying anything, and calling the first copy 「再次」 left the person unsure whether the clipboard held it.
 */
export function copyButtonWords(input: { enabled: boolean; copied: boolean; justCopied: boolean; reviewing: boolean }) {
  if (input.justCopied) return "已复制"
  if (input.copied) return input.reviewing ? "再次复制（做东西的 AI）" : "再次复制起步说明"
  if (input.enabled) return input.reviewing ? "复制给做东西的 AI" : "复制起步说明"
  return input.reviewing ? "复制给我的 AI" : "复制给我的 AI"
}

/** The same for the second copy, the reviewer's. */
export const reviewCopyWords = (input: { copied: boolean; justCopied: boolean }) => (input.justCopied ? "已复制" : input.copied ? "再次复制（审查的 AI）" : "复制给审查的 AI")

import { KEPT_WORDS } from "@minemods/mod-core/kept-words"
import type { StudioApi } from "../../api"

/**
 * Every page that says "this waits for you" carries the way to do it. The 制作现场 page said so for the blueprint (「等你确认」), for the ideas (「等你挑」) and for
 * things to look at (「等你验收」) while the only button was on 模组总览, which a person who followed the words had no reason to look for (broad16: they found it by trying
 * the next page). This is the one place that decides what waits and what the page offers about it, pure so it can be checked without a screen.
 */

export type WaitingKind = "blueprint" | "ideas" | "review"
export type Waiting = {
  kind: WaitingKind
  /** What waits, as one plain sentence. */
  text: string
  /** The button's words. */
  label: string
  /** "do": the button does it here (the same action as on 模组总览). "go": the button leads to the page where it is done. */
  how: "do" | "go"
  /** Why the button cannot be pressed now, when it cannot. */
  blocked?: string
}

export const WAITING_WORDS = {
  blueprint: "蓝图写好了，等你确认。确认了才会开始做。",
  ideas: "想法出来了，等你挑。挑好了才会出蓝图。",
  // `kept` of them were saved although their AI was not satisfied (or was cut short): they are waiting too, but they are not "做好了".
  review: (count: number, kept = 0) => (kept > 0 ? `有 ${count} 样等你验收，${KEPT_WORDS.among(count, kept)}。` : `有 ${count} 样做好了，等你验收。`),
  /** Under the confirm button when Studio's own AI is to start making but is not connected: the same sentence 模组总览 shows. */
  needsAi: "确认以后还要连上 AI 才能开始做。",
  confirm: { external: "确认蓝图", own: "确认，开始制作" },
  ideasGo: "去挑想法",
  reviewGo: "去验收",
  nothingToMake: "蓝图里没有要做的东西，先回工程总览看看。",
  running: "正在制作，等这一批做完再确认。",
} as const

/**
 * What happens after 「确认蓝图」 when an outside AI makes the content, said as the truth of that moment (broad19: people confirmed, then stopped, unsure whether the AI would
 * go on or had to be told). Studio knows whether the AI has a wait call pending (`blueprint_wait`): if so it starts by itself; if not, only the person can wake it.
 * `ai` is `ProjectOverview["blueprint_wait"]`'s value, absent when no wait call was ever seen.
 */
export type AiWait = "waiting" | "told" | "none" | undefined
export const AFTER_CONFIRM_WORDS = {
  waiting: "AI 已经在等，它会自己开始。",
  told: "AI 已经收到你的确认，正在开始。",
  /** `words` is what to say to the AI: 「开始做」 for a first start, 「继续做」 for the rest. */
  none: (words: string) => `回到你的 AI 窗口，说一句「${words}」就行。`,
  /** Under the confirm button, before confirming: what confirming leads to. */
  before: { waiting: "确认以后，AI 已经在等，它会自己开始。", none: "确认以后，要回到你的 AI 窗口说一句「开始做」，它才会开始。" },
} as const
export function afterConfirmWords(ai: AiWait, words: string) {
  return ai === "waiting" ? AFTER_CONFIRM_WORDS.waiting : ai === "told" ? AFTER_CONFIRM_WORDS.told : AFTER_CONFIRM_WORDS.none(words)
}
/** The sentence under the confirm button of an outside AI's draft; nothing for Studio's own AI (the button itself starts the making). */
export function beforeConfirmWords(external: boolean, ai: AiWait) {
  return external ? (ai === "waiting" ? AFTER_CONFIRM_WORDS.before.waiting : AFTER_CONFIRM_WORDS.before.none) : undefined
}

export type WaitingInput = {
  blueprint: { state: "draft" | "confirmed" } | null
  /** Things the blueprint would make (those not set aside). */
  madeCount: number
  /** Cards of ideas are on the table and the person has not said go. */
  ideasWaiting: boolean
  /** Things whose version waits for the person's verdict. */
  toReview: number
  /** Of `toReview`, how many were kept without a pass (`OverviewItem.ai_unsatisfied` / `ai_interrupted`). Left out: none. */
  keptReview?: number
  external: boolean
  running: boolean
}

/** What waits for the person right now, most pressing first (a blueprint to confirm comes before things nobody has made yet). */
export function waitingForYou(input: WaitingInput): Waiting[] {
  const list: Waiting[] = []
  if (input.blueprint?.state === "draft")
    list.push({
      kind: "blueprint",
      text: WAITING_WORDS.blueprint,
      label: input.external ? WAITING_WORDS.confirm.external : WAITING_WORDS.confirm.own,
      how: "do",
      // The same conditions 模组总览 gives its button: something to make, and nothing being made while the plan is open.
      ...(input.running ? { blocked: WAITING_WORDS.running } : !input.madeCount ? { blocked: WAITING_WORDS.nothingToMake } : {}),
    })
  if (input.ideasWaiting && !input.blueprint) list.push({ kind: "ideas", text: WAITING_WORDS.ideas, label: WAITING_WORDS.ideasGo, how: "go" })
  if (input.toReview > 0) list.push({ kind: "review", text: WAITING_WORDS.review(input.toReview, input.keptReview ?? 0), label: WAITING_WORDS.reviewGo, how: "go" })
  return list
}

/** The pieces of the confirm step that are the window's: the studio calls, and what to do in the page once the blueprint is confirmed. */
export type ConfirmInput = {
  projectId: string
  revision: number
  /** An outside AI makes the things; false: Studio's own AI is started right after. */
  external: boolean
  /** The question asked before making starts (models with no 六视图). False: the person chose to go and add them first, so nothing is confirmed. */
  ready: () => Promise<boolean>
  /** Called as soon as the blueprint is confirmed, before making is started. */
  afterConfirm?: () => void
  studio: Pick<StudioApi, "confirmBlueprint" | "startBlueprintProduction">
}

/**
 * 「确认蓝图」: the one action, whichever page it is pressed on. The question about missing 六视图 comes first (a question, never a wall); then the
 * blueprint is confirmed at the revision on screen (the app refuses if the AI changed it meanwhile); then, with Studio's own AI, making starts.
 */
export async function confirmDraft(input: ConfirmInput): Promise<{ confirmed: boolean; started: Awaited<ReturnType<StudioApi["startBlueprintProduction"]>> | null }> {
  if (!(await input.ready())) return { confirmed: false, started: null }
  await input.studio.confirmBlueprint({ projectId: input.projectId, revision: input.revision })
  input.afterConfirm?.()
  if (input.external) return { confirmed: true, started: null }
  return { confirmed: true, started: await input.studio.startBlueprintProduction({ projectId: input.projectId }) }
}


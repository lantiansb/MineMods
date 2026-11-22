// Kept apart from `asset-status` (which reads reviews from disk) so the renderer can use the words without pulling Node modules into the page.
/**
 * A version that is saved but was kept without passing its review is not "已做好" (broad19: the overview counted a Boss whose independent review
 * stopped it as made). Every count that says how many are done says the kept ones apart, in these words, so the strip, the road, the activity
 * line and a batch's last sentence cannot word them differently.
 */
const EACH = { unsatisfied: "留了一版但没通过审查", interrupted: "制作被中断，留了中断前的一版" } as const
export const KEPT_WORDS = {
  unsatisfied: (count: number) => `${count} 样${EACH.unsatisfied}`,
  interrupted: (count: number) => `${count} 样${EACH.interrupted}`,
  /**
   * The same two said of one thing, for the line on its own card (broad20: the card's 「做好了」 said 「是」 over a banner saying the AI was not satisfied). The very
   * words above with the count taken off, so a card, the strip and the activity line cannot word one kept version two ways.
   */
  each: EACH,
  /**
   * Beside 「有 N 样等你验收」, how many of those N were kept without a pass. Every place that says how many wait for the person says this the same way
   * (broad20: the entry said 「有 1 样等你验收」 while its card said the AI was not satisfied). `kept` is never more than `count`.
   */
  among: (count: number, kept: number) => `其中 ${Math.min(kept, count)} 样 AI 自己还不满意，或者没做完审查`,
} as const

/** Which of the two words a thing is kept under, if any (a cut-short making is never called unsatisfied). The one rule the strip, the entry and the card share. */
export const keptEach = (item: { ai_unsatisfied?: boolean; ai_interrupted?: boolean }) => (item.ai_interrupted ? KEPT_WORDS.each.interrupted : item.ai_unsatisfied ? KEPT_WORDS.each.unsatisfied : null)

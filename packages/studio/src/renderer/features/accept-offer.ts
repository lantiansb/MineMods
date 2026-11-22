import type { OverviewItem } from "../../api"

type Offered = Pick<OverviewItem, "status" | "asset_id" | "revision" | "facts">

/**
 * Whether the page puts 「可以，通过」 in front of the person for this thing. It is the answer to a question the page has asked: the thing waits for their yes or no
 * (`status` "review"), or a note on the thing asks whether it still fits after what it uses was remade (`stale`). A thing that waits for nothing has no such button, so
 * the card never says nothing waits for the person and offers them to accept it in the same breath.
 */
export function acceptOffered(item: Offered, problems: readonly { kind: string }[]): boolean {
  const saved = item.facts.saved && item.asset_id !== null && item.revision !== null && item.status !== "making"
  return saved && (item.status === "review" || problems.some((problem) => problem.kind === "stale"))
}

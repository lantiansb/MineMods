import type { Making } from "../../api"
import type { AssetCheck } from "./asset-check"

/**
 * When the machine check did not pass but the review of the same thing did, the card says so in one sentence and leaves it to the person. Nothing is explained here: a conflict is
 * rare now that the check is judged with the reasons the gate accepted the work on, and a number that cannot tell a fault from a choice is advice and never refuses. What is left is
 * a real disagreement (a standard that changed after the work was saved, a version kept though its AI was not satisfied), and for that the picture is the answer.
 */
export function checkVersusReview(check: Pick<AssetCheck, "passed" | "unreadable"> | null | undefined, making: { review: Pick<NonNullable<Making["review"]>, "passed" | "independent"> | null } | null | undefined): string | null {
  const review = making?.review
  if (!check || check.unreadable || !review) return null
  if (check.passed && !review.passed) return `机器检查通过，${review.independent ? "审查" : "自己审查"}要求修改。`
  if (check.passed || !review.passed) return null
  return `机器检查没通过，${review.independent ? "审查" : "自己审查"}通过了：请看图自己决定。`
}

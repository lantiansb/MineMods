import type { MakingVersion } from "../../api"

/**
 * What a card's 「制作过程」 holds, and whether it is there at all.
 * - "making": an AI's making record: its rounds, pictures and review notes, with the saved versions above them.
 * - "versions": no making record, but two or more saved versions (an imported or older thing; a gameplay the naming conversion saved anew, the code before
 *   kept as the version before). Only the versions, to look at, compare side by side and go back to: no making story is made up for it.
 * - null: neither. One saved version has nothing to compare, and the card has no tab.
 * `savedVersions` is null until it has been read.
 */
export type HistoryReach = "making" | "versions" | null
export function historyReach(input: { making: boolean; assetId: string | null; savedVersions: number | null }): HistoryReach {
  if (input.making) return "making"
  return input.assetId !== null && (input.savedVersions ?? 0) >= 2 ? "versions" : null
}

/** Said on 「制作过程」 when there is no making record, so the versions alone are not taken for the whole story. */
export const NO_MAKING_RECORD_WORDS = "这一样没有 AI 的制作记录（比如导入的、更早做的），这里只有它保存过的各版：可以并排比，也可以回到旧版。"

/** Who made a saved version, as its slot says it. The one there now says so; a conversion says it was one even then. */
export function versionWords(version: Pick<MakingVersion, "by" | "from" | "current">) {
  const by = version.by === "ai" ? "AI" : version.by === "person" ? "你改" : version.by === "converted" ? "从旧命名自动转换" : `回到第 ${version.from} 版`
  if (!version.current) return by
  return version.by === "converted" ? `现在 · ${by}` : "现在"
}

import type { OverviewItem } from "../../api"

/**
 * The 模型精细度 a model was really made by, said on the model itself and only where it is not the button at the top (a Boss is made by 高 under a 中 button). The label at
 * the top stays the setting for every model; this is what one task was told, so the person never has to wonder whether the top label was ignored.
 * `top` is the button as it stands; without it nothing is said.
 */
export function detailTag(item: Pick<OverviewItem, "detail"> | null | undefined, top: "low" | "medium" | "high" | undefined): string | null {
  return item?.detail && top !== undefined && item.detail.level !== top ? `精细度 ${item.detail.label}` : null
}

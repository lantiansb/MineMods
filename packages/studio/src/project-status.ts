import type { GameTarget, OverviewItem } from "./api"
import type { Project } from "@minemods/mod-core/project"

export const planCounts = (entries: readonly { out_of_scope?: string | null }[]) => {
  const skipped = entries.filter((entry) => entry.out_of_scope).length
  return { planned: entries.length - skipped, skipped }
}

export const activityText = (event: { tool?: string; mark: string; text: string }) =>
  event.tool === "self_review" && event.mark === "fail" ? "Studio 退回了这次提交的自评。" : event.text

export const hasIdea = (request?: string | null) => !!request?.trim()
export const playScope = (total: number, counted: number) => `工程共 ${total} 样 · 其中 ${counted} 样按玩法检查`
export const originalBrief = (item: Pick<OverviewItem, "key" | "asset_id" | "facts">) => !!item.key && !!item.asset_id && item.facts.saved
export const savedLabel = (item: Pick<OverviewItem, "status" | "facts" | "review_asked">, judged: boolean) =>
  item.status === "saved" && !item.facts.accepted && !item.review_asked && !judged ? "已保存" : null

type TargetProject = Pick<Project, "target" | "targets">
export const targetIds = (project: TargetProject) => project.targets ?? [project.target]
export function javaMajors(projects: readonly TargetProject[], catalogue: readonly GameTarget[], fallback?: GameTarget) {
  const ids = new Set<string>(projects.flatMap(targetIds))
  return [...new Set((ids.size ? catalogue.filter((target) => ids.has(target.id)) : fallback ? [fallback] : []).map((target) => target.java))]
}

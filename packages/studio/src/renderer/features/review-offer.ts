import type { Project } from "@minemods/mod-core/project"
import type { ProjectRun } from "@minemods/mod-core/workspace-runs"
import { reviewEnabled, type PublicConnection } from "../../connection"

export function reviewOffer(
  connection: PublicConnection | undefined,
  project: Project,
  runs: readonly ProjectRun[],
  dismissed: (key: string) => boolean,
) {
  if (
    !connection ||
    connection.mode !== "mcp" ||
    connection.review !== undefined ||
    connection.reviewDefaults !== "by-mode" ||
    reviewEnabled(connection)
  )
    return null
  const bossKey = "studio.review.boss." + project.id
  if (
    !dismissed(bossKey) &&
    project.blueprint?.entries.some((e) => !e.out_of_scope && (e.tier?.level === "boss" || e.tier?.level === "epic"))
  )
    return { key: bossKey, text: "工程里有了 Boss 档或史诗档的生物，建议打开审查。" }
  const first = "studio.review.first"
  if (
    !dismissed(first) &&
    runs.some(
      (r) =>
        r.project_id === project.id &&
        r.tasks.some((t) => t.state === "completed" && project.workspace.assets.some((a) => a.id === t.asset_id)),
    )
  )
    return { key: first, text: "第一样东西做好了。以后每样东西做完，要不要再请另一个 AI 检查一遍？" }
  return null
}

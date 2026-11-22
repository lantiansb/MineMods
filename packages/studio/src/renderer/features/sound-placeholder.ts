import type { buildProjectOverview } from "@minemods/mod-core/asset-overview"
import type { Project } from "@minemods/mod-core/project"
import { soundMoments } from "@minemods/mod-core/sound-moments"

export function supersededSound(project: Project, item: Pick<Awaited<ReturnType<typeof buildProjectOverview>>["items"][number], "kind" | "status" | "asset_id" | "title" | "key">) {
  if (item.kind !== "sound" || item.status !== "out_of_scope") return false
  const sounds = project.workspace.assets.filter((asset) => asset.document.kind === "sound")
  if (sounds.some((asset) => asset.id === item.asset_id || asset.title === item.title || (asset.document.kind === "sound" && asset.document.name === item.key))) return true
  // Older blueprints could set aside all custom sounds for a creature under one heading.
  const heading = item.title.trim().replace(/[（(][^（）()]*[）)]$/, "").trim()
  return project.entities.some((entity) =>
    heading === entity.name + "自己的声音" &&
    soundMoments(project, entity.id).some(({ ref }) => !!ref && typeof ref !== "string" && sounds.some((asset) => asset.id === ref.asset)),
  )
}

import type { Project } from "@minemods/mod-core/project"
import { builtWorkspaceAssets } from "@minemods/mod-core/workspace"

type Asset = Project["workspace"]["assets"][number]

/**
 * The status an outside AI is told of each asset: the project's own, except a skill.
 * Skills are a staged module, so every one of them is stored as `design`; what the build takes
 * (a skill bound to something, or one a creature uses) is said as `ready`, the others stay `design`.
 * One reading for the whole project, its summary and a single asset, so the three never disagree.
 */
export function externalAssetStatus(project: Project): (asset: Pick<Asset, "id" | "module" | "status">) => Asset["status"] {
  if (!project.workspace.assets.some((asset) => asset.module === "ability")) return (asset) => asset.status
  const built = new Set(builtWorkspaceAssets(project).filter((asset) => asset.module === "ability").map((asset) => asset.id))
  return (asset) => (asset.module === "ability" ? (built.has(asset.id) ? "ready" : "design") : asset.status)
}

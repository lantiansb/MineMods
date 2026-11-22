import type { Project } from "@minemods/mod-core/project"

/** How many projects the title screen lists under 「接着做」; the rest are one press away. */
export const WORLDS_SHOWN = 3

type Things = Pick<Project, "entities" | "blocks" | "items" | "recipes" | "conception" | "workspace">
/** How many things a project holds, however each was made: one thing may be an entry, an idea and an asset at once. */
export const thingCount = (project: Things) =>
  new Set([
    ...project.entities.map((value) => value.id),
    ...project.blocks.map((value) => value.id),
    ...project.items.map((value) => value.id),
    ...project.recipes.map((value) => value.id),
    ...project.conception.entries.map((value) => value.entity_id ?? value.id),
    ...project.workspace.assets.map((value) => value.id),
  ]).size

/** The most recently changed first. Studio keeps when a project was last changed, not when it was last opened, so that is what the list goes by and says. */
export const recentWorlds = <T extends { project: Pick<Project, "updated_at"> }>(entries: readonly T[], limit: number = WORLDS_SHOWN) =>
  [...entries].sort((left, right) => right.project.updated_at.localeCompare(left.project.updated_at)).slice(0, limit)

const twoDigits = (value: number) => String(value).padStart(2, "0")
/** One line under a project's name: what it holds and when it last changed. */
export function worldLine(project: Things & Pick<Project, "updated_at">) {
  const at = new Date(project.updated_at)
  const count = thingCount(project)
  return `${count ? `${count} 样东西` : "还是空的"} · ${twoDigits(at.getMonth() + 1)}-${twoDigits(at.getDate())} 改过`
}

/** The second line: what waits for the person, when something is known to. Nothing is said when nothing is known. */
export const worldWaits = (toReview: number | null | undefined) => (toReview ? `${toReview} 样等你验收` : null)

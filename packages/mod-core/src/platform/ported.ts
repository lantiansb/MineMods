import { BuildStop } from "../build-stop"
import type { GenTarget } from "./adapter"

/**
 * What of a project a facade target (Forge, NeoForge) can already be generated for, and what not yet. A build for such
 * a target stops before anything is written when the project uses a feature group that has not been ported, and says
 * which: never a mod that compiles without a part of what the project says. Fabric generates everything, as before.
 *
 * Each group is one porting task of 平台层-移植清单.md; whoever ports a group removes its entry here (and adds its
 * javac and real-game checks), so the groups can be ported in parallel without touching each other's lines.
 */

type Entity = {
  name: string
  abilities?: readonly unknown[] | null | undefined
  combos?: readonly unknown[] | null | undefined
  boss?: unknown
  flight?: unknown
  habits?: unknown
  hitbox?: unknown
  tempt?: readonly unknown[] | null | undefined
  runtime?: { explosion?: unknown; death_drop?: unknown } | undefined
}
type Block = { name: string; lucky?: unknown; generation?: unknown; shape?: unknown; bounce?: number | null | undefined; launch?: number | null | undefined; experience?: unknown; fuel?: unknown }
type Item = { name: string; tool?: unknown; food?: unknown; fuel?: unknown }
type ProjectShape = { entities: readonly Entity[]; blocks: readonly Block[]; items: readonly Item[]; workspace: { assets: readonly { document: { kind: string } }[] } }

/** A feature group not ported yet: its id in the porting checklist, its name in the person's words, and what of the project uses it. */
export type Unported = { group: string; words: string; used: string }

// Every group of 平台层-移植清单.md is ported: none is left. A group added later (a new feature not yet written for the facade) goes here.
const GROUPS: readonly { group: string; words: string; uses: (project: ProjectShape) => string[] }[] = []

/** The feature groups this project uses that the target cannot be generated for yet; none for Fabric. */
export function unportedFeatures(project: ProjectShape, target: GenTarget): Unported[] {
  if (!target.loader.facade) return []
  return GROUPS.flatMap((entry) => {
    const used = entry.uses(project)
    return used.length ? [{ group: entry.group, words: entry.words, used: [...new Set(used)].join("、") }] : []
  })
}

/** Stops a build for a target that cannot make all of this project yet, saying what in the person's words. */
export function assertPorted(project: ProjectShape, target: GenTarget) {
  const missing = unportedFeatures(project, target)
  if (!missing.length) return
  throw new BuildStop(
    "target_unported",
    missing.map((entry) => ({ text: `${target.manifest.id} 还不能生成${entry.words}（${entry.used}用到了）。`, fix: "" })).concat([{ text: "", fix: "先用 Fabric 1.21.1 构建这个工程；这些部分移植到这个目标之后就能构建。" }]),
  )
}

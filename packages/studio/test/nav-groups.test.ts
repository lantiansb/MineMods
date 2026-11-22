import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { ModuleKindSchema } from "@minemods/mod-core/workspace-modules"

/**
 * Every kind of asset has a place in the left column. The bar (Boss 能力 6) and the arena's fixtures (12) were added as kinds without one, so a blueprint's bronze
 * bar and compass carts were nowhere in the column (the 蚩尤 run of 2026-11-15). Read from the component's own list of groups: `single("<kind>"…)` and `modules: […]`.
 */
test("every asset kind is in a group of the left column", () => {
  const source = readFileSync(path.join(import.meta.dir, "../src/renderer/features/project-navigation.tsx"), "utf8")
  const list = source.slice(source.indexOf("const groups: Group[] = ["), source.indexOf("export function ProjectNavigation"))
  const singles = [...list.matchAll(/single\("([a-z_]+)"/g)].map((match) => match[1]!)
  const grouped = [...list.matchAll(/modules: \[([^\]]*)\]/g)].flatMap((match) => [...match[1]!.matchAll(/"([a-z_]+)"/g)].map((kind) => kind[1]!))
  // The parts group lists its kinds in a constant of its own.
  const parts = [...(source.match(/const parts: ModuleKind\[\] = \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((kind) => kind[1]!)
  const shown = new Set([...singles, ...grouped, ...parts])
  expect(ModuleKindSchema.options.filter((kind) => !shown.has(kind))).toEqual([])
})

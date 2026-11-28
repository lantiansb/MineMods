import { z } from "zod"
import { bookName, creatureName } from "./registry-name"
import type { Project } from "./project"
import type { WorkspaceAsset } from "./workspace"

export const ImportMappingSchema = z.array(z.strictObject({
  source: z.string().trim().min(1).max(160),
  action: z.enum(["map", "rename"]),
  target: z.string().trim().min(1).max(160),
})).max(256)
export type ImportMapping = z.infer<typeof ImportMappingSchema>
export type MappedThing = {
  id: string
  node: string
  kind: WorkspaceAsset["module"] | "creature"
  title: string
  name: string | null
}
export type MappingDecision = {
  row: ImportMapping[number]
  line: number
  source: MappedThing
  target?: MappedThing
  changed: boolean
}
export const isAssetId = (value: string) => z.uuid().safeParse(value).success
export const importNameField = (kind: MappedThing["kind"]) =>
  ["item", "block", "book", "creature"].includes(kind) ? "identifier"
    : ["sound", "music", "particle", "effect", "ability", "fixture"].includes(kind) ? "name" : null

const thingName = (asset: WorkspaceAsset) => {
  if (asset.document.kind === "book") return bookName({ id: asset.id, document: asset.document })
  const field = importNameField(asset.module)
  const value = field ? (asset.document as Record<string, unknown>)[field] : null
  return typeof value === "string" && value ? value : null
}

export function importThings(project: Project) {
  const assets = project.workspace.assets
  const creatures = new Map(project.entities.map((entity) => [entity.id, {
    id: entity.id, node: "row:" + entity.id, kind: "creature" as const, title: entity.name, name: creatureName(entity),
  }]))
  const byId = new Map<string, MappedThing>(creatures)
  for (const asset of assets) {
    const creature = asset.document.kind === "entity" ? creatures.get(asset.document.model_asset_id) : asset.document.kind === "model" ? creatures.get(asset.id) : undefined
    byId.set(asset.id, creature ?? { id: asset.id, node: asset.id, kind: asset.module, title: asset.title, name: thingName(asset) })
  }
  for (const item of project.items) if (!byId.has(item.id)) byId.set(item.id, { id: item.id, node: item.id, kind: "item", title: item.name, name: item.identifier })
  for (const block of project.blocks) if (!byId.has(block.id)) byId.set(block.id, { id: block.id, node: block.id, kind: "block", title: block.name, name: block.identifier })
  return { byId, byName: [...new Set(byId.values())] }
}

export const mappingLine = (decision: Pick<MappingDecision, "line" | "row">) => `对照表第 ${decision.line} 行（${decision.row.source} → ${decision.row.target}）`

export function resolveImportMapping(source: Project, main: Project, previous: ImportMapping, supplied: ImportMapping, blocked: string[]) {
  const from = importThings(source)
  const into = importThings(main)
  const candidate = (project: Project, catalog: typeof from, selector: string, blueprint: boolean) => {
    const id = catalog.byId.get(selector)
    if (id) return [id]
    const name = selector.startsWith(project.mod_id + ":") ? selector.slice(project.mod_id.length + 1) : selector
    const alias = blueprint ? project.blueprint?.entries.find((entry) => entry.key === selector)?.asset_id : null
    return [...new Set([...catalog.byName.filter((thing) => thing.name === name), ...(alias && catalog.byId.has(alias) ? [catalog.byId.get(alias)!] : [])])]
  }
  const rows = new Map<string, MappingDecision>()
  for (const [history, list] of [[true, previous], [false, supplied]] as const) {
    const seen = new Set<string>()
    for (const [index, row] of list.entries()) {
      const line = index + 1
      const matches = candidate(source, from, row.source, true)
      const text = mappingLine({ line, row })
      if (matches.length !== 1) {
        blocked.push(matches.length ? `${text}找到了多样源内容，请改用资产编号。` : `${text}找不到源内容。`)
        continue
      }
      const thing = matches[0]!
      if (seen.has(thing.node)) {
        blocked.push(`${text}和同一张表里另一行指向同一样源内容。`)
        continue
      }
      seen.add(thing.node)
      const prior = rows.get(thing.node)
      rows.set(thing.node, { row: { ...row, source: thing.id }, source: thing, line, changed: !history && Boolean(previous.length) && (!prior || prior.row.action !== row.action || prior.row.target !== row.target) })
    }
  }
  for (const decision of rows.values()) {
    if (decision.row.action !== "map") continue
    const matches = candidate(main, into, decision.row.target, false)
    const same = matches.filter((target) => target.kind === decision.source.kind)
    if (same.length === 1) decision.target = same[0]
    else blocked.push(`${mappingLine(decision)}${!matches.length ? "在主工程里找不到目标。" : !same.length ? "源内容和目标的种类不同。" : "目标有重名，请改用资产编号。"}`)
  }
  return rows
}

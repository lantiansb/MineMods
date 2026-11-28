import { MODULES, type ModuleKind } from "@minemods/mod-core/workspace-modules"
import { kindLabel } from "../words"

/**
 * 从别的工程导入: what kind of thing a row of the lists is, in the window's words. A creature is listed once as itself (`creature`, its model and motions with it) and, beside it,
 * its setting (the `entity` document: numbers, abilities, sounds), which the asset kinds also call 「生物」: r29c said it apart, as it read as the same creature listed twice.
 */
export const importKindName = (kind: string) => (kind === "creature" ? "生物" : kind === "entity" ? "生物的设定" : kind in MODULES ? kindLabel(kind, MODULES[kind as ModuleKind].label) : kind)

export function readMappingTable(text: string): import("@minemods/mod-core/project-import").ImportMapping {
  return text.split(/\r?\n/).flatMap((value, index) => {
    const line = value.trim()
    if (!line) return []
    const [source, action, target, extra] = line.includes("\t") ? line.split(/\t+/).map((part) => part.trim()) : line.split(/\s+/)
    const mode = action === "对上" || action === "map" ? "map" : action === "改名" || action === "rename" ? "rename" : null
    if (!source || !mode || !target || extra !== undefined) throw new Error(`对照表第 ${index + 1} 行没有写全。每行写原来的东西、对上或改名、要用的新编号或名字。`)
    return [{ source, action: mode, target }]
  })
}

export function writeMappingTable(rows: import("@minemods/mod-core/project-import").ImportMapping) {
  return rows.map(({ source, action, target }) => [source, action === "map" ? "对上" : "改名", target].join("\t")).join("\n")
}

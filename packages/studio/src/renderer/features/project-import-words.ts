import { MODULES, type ModuleKind } from "@minemods/mod-core/workspace-modules"
import { kindLabel } from "../words"

/**
 * 从别的工程导入: what kind of thing a row of the lists is, in the window's words. A creature is listed once as itself (`creature`, its model and motions with it) and, beside it,
 * its setting (the `entity` document: numbers, abilities, sounds), which the asset kinds also call 「生物」: r29c said it apart, as it read as the same creature listed twice.
 */
export const importKindName = (kind: string) => (kind === "creature" ? "生物" : kind === "entity" ? "生物的设定" : kind in MODULES ? kindLabel(kind, MODULES[kind as ModuleKind].label) : kind)

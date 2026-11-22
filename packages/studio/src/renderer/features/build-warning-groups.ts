import { buildWarningSeverity, type BuildWarning } from "@minemods/mod-core/build-warnings"

type Move = { id: string | number; title: string }
export type BuildWarningRow = { move?: Move; warnings: BuildWarning[] }

export function groupBuildWarnings(warnings: readonly BuildWarning[]) {
  const levels = {
    defect: { count: 0, rows: [] as BuildWarningRow[], moves: new Map<string, BuildWarningRow>() },
    advice: { count: 0, rows: [] as BuildWarningRow[], moves: new Map<string, BuildWarningRow>() },
  }
  for (const warning of warnings) {
    const level = levels[buildWarningSeverity(warning)]
    level.count++
    const abilities = warning.refs?.filter((ref) => ref.kind === "ability") ?? []
    // A combo can cite its first move, but that does not make the warning about the move itself.
    const move = warning.about_id && abilities.length === 1 && !warning.refs?.some((ref) => ref.kind === "combo") ? abilities[0] : undefined
    if (move) {
      const key = JSON.stringify([warning.about_id, move.id, warning.rule])
      const existing = level.moves.get(key)
      if (existing) {
        existing.warnings.push(warning)
        continue
      }
      const row = { move, warnings: [warning] }
      level.moves.set(key, row)
      level.rows.push(row)
    } else {
      level.rows.push({ warnings: [warning] })
    }
  }
  return { defect: { count: levels.defect.count, rows: levels.defect.rows }, advice: { count: levels.advice.count, rows: levels.advice.rows } }
}

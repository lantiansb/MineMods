import { type FixturesLit, staggerConditions, staggerList, type Stagger } from "./combat"
import { abilityRef, assetRef, comboRef } from "./finding-refs"
import type { PlacedFixture } from "./arena"

type Start = {
  when?: readonly ({ if: string } | FixturesLit)[] | undefined
  weight_when?: readonly ({ if: string } | FixturesLit)[] | undefined
}
type Choice = { id?: string; name?: string; asset?: string; start: Start }
export function fixtureConditionUses(entity: {
  stagger?: Stagger | undefined
  abilities?: readonly Choice[] | null | undefined
  shared_abilities?: readonly Choice[] | null | undefined
  combos?: readonly Choice[] | null | undefined
}) {
  const forChoice = (choice: Choice, ref: typeof abilityRef) => {
    const refs = [
      ...(choice.id ? [ref({ id: choice.id, name: choice.name ?? choice.id })] : []),
      ...(choice.asset ? [assetRef(choice.asset)] : []),
    ]
    return [...(choice.start?.when ?? []), ...(choice.start?.weight_when ?? [])].map((rule) => ({ rule, refs }))
  }
  return [
    ...staggerList(entity.stagger).flatMap(staggerConditions).map((rule) => ({ rule, refs: [] })),
    ...(entity.abilities ?? []).flatMap((choice) => forChoice(choice, abilityRef)),
    ...(entity.shared_abilities ?? []).flatMap((choice) => forChoice(choice, abilityRef)),
    ...(entity.combos ?? []).flatMap((choice) => forChoice(choice, comboRef)),
  ].flatMap(({ rule, refs }) => rule.if === "fixtures_lit" ? [{ rule: rule as FixturesLit, refs }] : [])
}

export const fixtureConditions = (entity: Parameters<typeof fixtureConditionUses>[0]) => fixtureConditionUses(entity).map(({ rule }) => rule)
type Spot = Pick<PlacedFixture, "forward" | "left">
const bearing = (spot: Spot) => (Math.atan2(-spot.left, spot.forward) * 180) / Math.PI
const delta = (degrees: number) => Math.abs(((((degrees + 540) % 360) + 360) % 360) - 180)
export function litInArc(spots: readonly Spot[], yaw: number, arc: number) {
  return spots.filter(
    (spot) => (spot.left === 0 && spot.forward === 0) || delta(bearing(spot) - yaw) <= arc / 2 + 0.0005,
  ).length
}
// A count only changes as an edge passes a fixture. Check the edges and the open spans between them.
export function feasibleArc(spots: readonly Spot[], rule: FixturesLit) {
  const arc = rule.within_arc ?? 360
  const edges = spots
    .flatMap((spot) => [-1, 1].map((sign) => (bearing(spot) + (sign * arc) / 2 + 360) % 360))
    .sort((a, b) => a - b)
  const inside = edges.map((edge, i) => litInArc(spots, (edge + (edges[i + 1] ?? edges[0]! + 360)) / 2, arc))
  const max = Math.max(0, ...edges.map((edge) => litInArc(spots, edge, arc)), ...inside)
  const narrow =
    max >= rule.count &&
    !inside.some((count, i) => count >= rule.count && (edges[i + 1] ?? edges[0]! + 360) - edges[i]! > 0.002)
  return { max, narrow }
}

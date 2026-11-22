import type { ImpactFx } from "./impact-fx"

// The moments of impact of a creature, apart from the schema: sound.ts (imported by data-words, imported by ability-words, which impact-fx.ts imports) can then read them with no cycle.
type Rule = { when: { with: string }; result: { impact?: ImpactFx | undefined } }
type Staged = {
  id?: string
  name: string
  stages?: readonly { kind: string; end?: { collision?: readonly Rule[] | undefined; impact?: { wall?: ImpactFx | undefined; touch?: ImpactFx | undefined } | undefined } | undefined }[] | undefined
  moves?: readonly unknown[] | undefined
}
type Dashed = { type: "dash"; impact?: { wall?: ImpactFx | undefined; touch?: ImpactFx | undefined } | undefined }
const dashOf = (moves: readonly unknown[]) => moves.find((move): move is Dashed => typeof move === "object" && move !== null && (move as { type?: unknown }).type === "dash")

/** Where one is: the words a person reads (for the sound table and the pictures: 「撞上时」, not a second) and the path in the creature's document. */
export type ImpactSlot = { fx: ImpactFx; ability: number | null; key: string; words: string; path: (string | number)[] }
const WITH: Record<string, string> = { world: "撞墙", own_terrain: "撞上自己立的地形", other_terrain: "撞上别人立的地形" }

/**
 * Every moment of impact a creature has, numbered in one order the generated Java and every reader share: for each ability in order its stages' collision rules,
 * its loops' own wall and touch, then its dash's; then each stagger's start. `key` names it for the generator (`a2.s1.c0`, `a2.s1.wall`, `a2.dash.touch`, `stagger.1`).
 */
export function impactSlots(abilities: readonly Staged[], staggers: readonly { id?: string | undefined; enter?: ImpactFx | undefined }[] = []): ImpactSlot[] {
  const slots: ImpactSlot[] = []
  abilities.forEach((ability, a) => {
    ability.stages?.forEach((stage, s) => {
      stage.end?.collision?.forEach((rule, c) => {
        if (rule.result.impact) slots.push({ fx: rule.result.impact, ability: a, key: `a${a}.s${s}.c${c}`, words: `招式「${ability.name}」循环段${WITH[rule.when.with] ?? "撞上"}时`, path: ["stages", s, "end", "collision", c, "result", "impact"] })
      })
      for (const side of ["wall", "touch"] as const) {
        const fx = stage.end?.impact?.[side]
        if (fx) slots.push({ fx, ability: a, key: `a${a}.s${s}.${side}`, words: `招式「${ability.name}」循环段${side === "wall" ? "撞墙" : "撞到生物"}时`, path: ["stages", s, "end", "impact", side] })
      }
    })
    const dash = dashOf(ability.moves ?? [])
    const index = (ability.moves ?? []).indexOf(dash as unknown)
    for (const side of ["wall", "touch"] as const) {
      const fx = dash?.impact?.[side]
      if (fx) slots.push({ fx, ability: a, key: `a${a}.dash.${side}`, words: `招式「${ability.name}」冲刺${side === "wall" ? "撞墙" : "撞到生物"}时`, path: ["moves", index, "impact", side] })
    }
  })
  staggers.forEach((row, i) => {
    if (row.enter) slots.push({ fx: row.enter, ability: null, key: `stagger.${i}`, words: `进入硬直${row.id ? `「${row.id}」` : ""}时`, path: ["stagger", ...(staggers.length > 1 || row.id ? [i] : []), "enter"] })
  })
  return slots
}

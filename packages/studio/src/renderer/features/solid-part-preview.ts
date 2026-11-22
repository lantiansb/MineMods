import { hitboxAppearance, hitboxBoxes } from "@minemods/mod-core/creature-hitbox"
import type { Hitbox } from "@minemods/mod-core/entity-runtime"
import type { ModelDesign } from "@minemods/studio-ai/contracts"

export function solidPartOutlines(body: Hitbox | null | undefined, design: Pick<ModelDesign, "bones"> | null) {
  if (!design || !(body?.core.solid || body?.blockers?.length || body?.parts?.some((part) => part.solid))) return []
  return hitboxBoxes(body, design).flatMap((box) => box.solid
    ? [{ name: box.name, min: box.min, max: box.max, color: hitboxAppearance(box).stroke }]
    : [])
}

export function solidPartLegend(boxes: readonly { name: string }[]) {
  return "青绿色线标出实心部位摆好时的位置。" + boxes.map(({ name }) => `「${name}」`).join("、")
}

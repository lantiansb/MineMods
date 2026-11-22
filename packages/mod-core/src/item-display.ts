import { z } from "zod"

export const ITEM_DISPLAY_SLOTS = ["firstperson_righthand", "firstperson_lefthand", "thirdperson_righthand", "thirdperson_lefthand"] as const
export type ItemDisplaySlot = typeof ITEM_DISPLAY_SLOTS[number]
const vector = (min: number, max: number) => z.tuple([z.number().finite().min(min).max(max), z.number().finite().min(min).max(max), z.number().finite().min(min).max(max)])
export const ItemTransformSchema = z.strictObject({ translation: vector(-80, 80), rotation: vector(-180, 180), scale: vector(0, 4) })
export type ItemTransform = z.infer<typeof ItemTransformSchema>
export const ItemDisplaySchema = z.strictObject({
  firstperson_righthand: ItemTransformSchema.optional(),
  firstperson_lefthand: ItemTransformSchema.optional(),
  thirdperson_righthand: ItemTransformSchema.optional(),
  thirdperson_lefthand: ItemTransformSchema.optional(),
})
export type ItemDisplay = z.infer<typeof ItemDisplaySchema>

/** Raw Java item JSON values. Left-hand mirroring happens once, when rendering, not in the saved values. */
export function itemDisplayTransform(display: ItemDisplay | undefined, slot: ItemDisplaySlot, handheld = false, model = false): ItemTransform {
  if (display?.[slot]) return structuredClone(display[slot])
  if (model) return { translation: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
  const first = slot.startsWith("firstperson")
  const left = slot.endsWith("lefthand")
  return first
    ? { translation: [1.13, 3.2, 1.13], rotation: [0, handheld && left ? 90 : -90, handheld && left ? -25 : 25], scale: [0.68, 0.68, 0.68] }
    : handheld
      ? { translation: [0, 4, 0.5], rotation: [0, left ? 90 : -90, left ? -55 : 55], scale: [0.85, 0.85, 0.85] }
      : { translation: [0, 3, 1], rotation: [0, 0, 0], scale: [0.55, 0.55, 0.55] }
}

export function exportItemDisplay(display: ItemDisplay | undefined, handheld = false, model = false) {
  return Object.fromEntries(ITEM_DISPLAY_SLOTS.map(slot => [slot, itemDisplayTransform(display, slot, handheld, model)])) as Record<ItemDisplaySlot, ItemTransform>
}

export function itemDisplayPose(transform: ItemTransform, slot: ItemDisplaySlot) {
  const side = slot.endsWith("lefthand") ? -1 : 1
  return {
    translation: [transform.translation[0] * side, transform.translation[1], transform.translation[2]] as [number, number, number],
    rotation: [transform.rotation[0], transform.rotation[1] * side, transform.rotation[2] * side].map(value => value * Math.PI / 180) as [number, number, number],
    scale: [...transform.scale] as [number, number, number],
  }
}

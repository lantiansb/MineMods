import { expect, test } from "bun:test"
import { itemDisplayPose } from "@minemods/mod-core/item-display"
import { itemElementGeometry, itemHandAnchor } from "../src/renderer/item-display-scene"
import { itemDisplayKey, itemDisplaySync } from "../src/renderer/item-display-state"
import { formOf, setAt } from "../src/renderer/features/asset-edit-form"
import { settle } from "../src/renderer/features/asset-edit-words"

test("polling equal item values preserves drafts, while real external updates require reload", () => {
  const saved = { display: { firstperson_righthand: { translation: [1, 2, 3] } } }
  expect(itemDisplayKey({ color: "#ff0000", ...saved })).toBe(itemDisplayKey({ ...saved, color: "#ff0000" }))
  expect(itemDisplaySync(itemDisplayKey(structuredClone(saved)), itemDisplayKey(saved), true, null)).toBe("unchanged")
  expect(itemDisplaySync(itemDisplayKey({ ...saved, color: "#ff0000" }), itemDisplayKey(saved), true, null)).toBe("conflict")
  expect(itemDisplaySync("updated", "original", false, null)).toBe("replace")
  expect(itemDisplaySync("submitted", "original", true, "submitted")).toBe("replace")
  expect(itemDisplaySync("external edit", "original", true, "submitted")).toBe("conflict")
})

test("first and third person use mirrored hand anchors and Java transform semantics", () => {
  expect(itemHandAnchor("firstperson_righthand").position).toEqual([9.039, 15.682, 20.8])
  expect(itemHandAnchor("firstperson_lefthand").position).toEqual([-9.039, 15.682, 20.8])
  expect(itemHandAnchor("thirdperson_righthand").rotation).toBeCloseTo(-67.5 * Math.PI / 180)
  const transform = { translation: [2, 3, 4] as [number, number, number], rotation: [10, 20, 30] as [number, number, number], scale: [0.5, 0.75, 1] as [number, number, number] }
  expect(itemDisplayPose(transform, "firstperson_lefthand").translation).toEqual([-2, 3, 4])
  expect(transform.translation).toEqual([2, 3, 4])
  expect(itemDisplayPose(transform, "thirdperson_righthand").scale).toEqual([0.5, 0.75, 1])
})

test("preview mesh retains the exported dimensions and atlas coordinates", () => {
  const geometry = itemElementGeometry({ name: "blade", from: [7, 7, 7], to: [9, 23, 9], faces: Object.fromEntries(["east", "west", "up", "down", "south", "north"].map(face => [face, { texture: "#layer0", uv: [2, 4, 6, 8] }])) })
  geometry.computeBoundingBox()
  expect(geometry.boundingBox!.max.y - geometry.boundingBox!.min.y).toBe(16)
  expect(geometry.getAttribute("uv").getX(0)).toBe(2 / 16)
  expect(geometry.getAttribute("uv").getY(0)).toBe(1 - 4 / 16)
  geometry.dispose()
})

test("the ordinary item form preserves linked models and all four hand poses", () => {
  const display = Object.fromEntries(["firstperson_righthand", "firstperson_lefthand", "thirdperson_righthand", "thirdperson_lefthand"].map((slot, index) => [slot, { translation: [index, 2, 3], rotation: [10, 20, 30], scale: [1, 1, 1] }]))
  const document = { kind: "item", identifier: "blade", name: "原名", max_stack: 1, color: "#335577", texture: null, model_asset_id: "7d4c4d0e-6f0a-4d53-9d55-0b1a5b0f8a11", display }
  const edited = settle("item", setAt(document, "name", "改过的名字"))
  expect(edited).toMatchObject({ name: "改过的名字", model_asset_id: document.model_asset_id, display })
  const fields = formOf("item", edited, { advanced: true }).flatMap((section) => section.fields.map((field) => field.key))
  expect(fields).not.toContain("model_asset_id")
  expect(fields.some((key) => key === "display" || key.startsWith("display."))).toBe(false)
  expect(document.name).toBe("原名")
})

import { expect, test } from "bun:test"
import { annotationArrow, annotationBox, annotationPoint, annotationSourceMatches, annotationSvg } from "../src/renderer/model-annotation"
import { ModelAnnotationInputSchema } from "@minemods/studio-ai/model-annotation"

test("annotation coordinates follow the displayed image and clamp pointer movement beyond it", () => {
  const rect = { left: 40, top: 80, width: 400, height: 200 }
  expect(annotationPoint(240, 130, rect)).toEqual({ x: 0.5, y: 0.25 })
  expect(annotationPoint(1000, -10, rect)).toEqual({ x: 1, y: 0 })
  expect(annotationPoint(140, 105, { ...rect, width: 200, height: 100 })).toEqual({ x: 0.5, y: 0.25 })
})

test("circle bounds work when drawn toward the top left", () => {
  expect(annotationBox({ x: 0.8, y: 0.7 }, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, width: 0.6000000000000001, height: 0.6 })
})

test("arrows use image pixels so a wide image does not distort the arrow head", () => {
  const arrow = annotationArrow({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 1000, 500)
  expect(arrow).toContain("M 200 250 L 800 250")
  expect(arrow).toContain("L 800 250 L")
  expect(arrow).not.toContain("NaN")
})

test("model changes and project revisions reject stale screenshots", () => {
  const snapshot = { sourceKey: "model-a/texture-a", projectRevision: 10 }
  expect(annotationSourceMatches(snapshot, snapshot.sourceKey, 10)).toBe(true)
  expect(annotationSourceMatches(snapshot, "model-b/texture-a", 10)).toBe(false)
  expect(annotationSourceMatches(snapshot, snapshot.sourceKey, 11)).toBe(false)
})

test("export contains actual marks and safely escapes user text", () => {
  const svg = annotationSvg([
    { kind: "circle", start: { x: 0.8, y: 0.8 }, end: { x: 0.2, y: 0.2 }, part: "blade" },
    { kind: "arrow", start: { x: 0.1, y: 0.1 }, end: { x: 0.5, y: 0.5 }, part: null },
    { kind: "text", start: { x: 0.1, y: 0.1 }, text: '<script>&"', part: "blade" },
  ], 1000, 500)
  expect(svg).toContain('<ellipse cx="500" cy="250"')
  expect(svg).toContain("<path")
  expect(svg).toContain("&lt;script&gt;&amp;&quot;")
  expect(svg).not.toContain("<script>")
})

test("annotation requests satisfy the shared API contract with a real PNG and part context", () => {
  const input = ModelAnnotationInputSchema.parse({
    targetId: "00000000-0000-4000-8000-000000000001", projectRevision: 12,
    image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=",
    width: 1, height: 1, selectedPart: "weapon.blade",
    annotations: [
      { kind: "circle", start: { x: 0.2, y: 0.3 }, end: { x: 0.8, y: 0.9 }, part: "weapon.blade" },
      { kind: "arrow", start: { x: 0.5, y: 0.1 }, end: { x: 0.6, y: 0.9 }, part: null },
      { kind: "text", start: { x: 0.1, y: 0.2 }, text: "刀刃加宽", part: "weapon.blade" },
    ],
  })
  expect(input.image).toStartWith("data:image/png;base64,")
  expect(input.selectedPart).toBe("weapon.blade")
  expect(input.annotations[2]?.text).toBe("刀刃加宽")
  expect(input.projectRevision).toBe(12)
  expect(ModelAnnotationInputSchema.safeParse({ ...input, width: 2 }).success).toBe(false)
})

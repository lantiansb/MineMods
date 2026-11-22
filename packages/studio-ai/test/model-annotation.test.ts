import { expect, test } from "bun:test"
import { AnnotationMarkSchema, ModelAnnotationInputSchema } from "../src/model-annotation"

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n9kAAAAASUVORK5CYII="
const annotation = {
  targetId: crypto.randomUUID(), projectRevision: 7, image, width: 1, height: 1, selectedPart: "blade",
  annotations: [{ kind: "circle" as const, start: { x: 0.1, y: 0.2 }, end: { x: 0.5, y: 0.8 }, part: "blade" }],
}

test("annotation accepts a PNG with normalized marks and rejects a different canvas or broken capture", () => {
  expect(ModelAnnotationInputSchema.parse(annotation)).toEqual(annotation)
  expect(ModelAnnotationInputSchema.safeParse({ ...annotation, width: 2 }).success).toBe(false)
  expect(ModelAnnotationInputSchema.safeParse({ ...annotation, image: "data:image/png;base64,bm90IHBuZw==" }).success).toBe(false)
  expect(ModelAnnotationInputSchema.safeParse({ ...annotation, annotations: [] }).success).toBe(false)
  expect(ModelAnnotationInputSchema.safeParse({ ...annotation, projectRevision: -1 }).success).toBe(false)
})

test("circle and arrow need an end, text needs words, and coordinates stay on the picture", () => {
  for (const kind of ["circle", "arrow", "text"]) expect(AnnotationMarkSchema.safeParse({ kind, start: { x: 0, y: 0 }, part: null }).success).toBe(false)
  expect(AnnotationMarkSchema.safeParse({ kind: "text", start: { x: 0.2, y: 0.3 }, text: "把这里改成蓝色", part: null }).success).toBe(true)
  expect(AnnotationMarkSchema.safeParse({ ...annotation.annotations[0], end: { x: 1.1, y: 0.5 } }).success).toBe(false)
})

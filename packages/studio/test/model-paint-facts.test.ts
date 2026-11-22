import { expect, test } from "bun:test"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { geoCube, modelAtlas } from "@minemods/studio-ai/model-paint"
import slime from "../../studio-ai/test/fixtures/look/good/sprout-slime.json"
import { lookJob, reviewJob } from "../src/main/look-job"
import { paintedPreview } from "../src/renderer/model-paint-preview"

/**
 * 第 1 步: every look of a model says how flat its texture is (the share of its painted area that is the one colour its face is mostly
 * painted in), for the maker and the reviewer alike; and the page's own preview of a model draws its turned, grown and mirrored cubes
 * as the build writes them.
 */

const model = { kind: "model" as const, ...ModelDesignSchema.parse(slime.model) }

test("a look of a model says its texture's flat share among the budget facts, and the review hears the same", () => {
  const plain = lookJob(model, null).budget_facts!
  const flat = plain.find((line) => line.startsWith("贴图量出来的平涂占比"))
  expect(flat).toBeDefined()
  expect(flat).toContain("没有写 shading")
  expect(reviewJob(model, null).budget_facts).toEqual(plain)
  const rich = lookJob({ ...model, shading: "rich" }, null).budget_facts!.find((line) => line.startsWith("贴图量出来的平涂占比"))!
  const percent = (line: string) => Number(/平涂占比 (\d+)%/.exec(line)![1])
  expect(percent(rich)).toBeLessThan(percent(flat!))
  expect(rich).toContain('写了 shading: "rich"')
})

test("the page's own preview of a model writes a turned, grown, mirrored cube as the build does", () => {
  // No page here: a canvas that hands back an empty picture is all the preview needs of one.
  const page = globalThis as unknown as Record<string, unknown>
  const had = { document: page.document, ImageData: page.ImageData }
  page.document = { createElement: () => ({ getContext: () => ({ putImageData: () => undefined }), toDataURL: () => "data:image/png;base64," }) }
  page.ImageData = class {}
  const at = slime.model.bones.findIndex((bone) => bone.cubes.length > 0)
  const design = ModelDesignSchema.parse({ ...slime.model, bones: slime.model.bones.map((bone, index) => (index === at ? { ...bone, cubes: bone.cubes.map((cube, place) => (place === 0 ? { ...cube, rotation: [0, 30, 0], inflate: 0.5, mirror: true } : cube)) } : bone)) })
  const preview = (() => {
    try {
      return paintedPreview(design)!
    } finally {
      // Whatever this test put on the global object is taken off again: other tests run in the same process.
      for (const [key, value] of Object.entries(had)) if (value === undefined) delete page[key]
      else page[key] = value
    }
  })()
  const cube = (preview.geometry["minecraft:geometry"][0]!.bones[at]! as unknown as { cubes: Record<string, unknown>[] }).cubes[0]!
  expect(cube).toEqual(geoCube(design.bones[at]!.cubes[0]!, modelAtlas(design).filter((island) => island.boneIndex === at && island.cubeIndex === 0)) as never)
  expect(cube).toMatchObject({ rotation: [0, 30, 0], inflate: 0.5 })
})

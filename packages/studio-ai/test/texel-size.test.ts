import { expect, test } from "bun:test"
import { ModelDesignSchema } from "../src/contracts"
import { TEXTURE_SPACE_ERROR, faceSize, modelAtlas, paintModel } from "../src/model-paint"
import { SCRIPT_LIMITS, scriptApi } from "../src/script"

/**
 * epic r4: a frost dragon 24.4 blocks long with a 30-block wingspan, 301 cubes, needed a sheet 512 wide and 1196 tall at one texel per model pixel,
 * past the largest texture any tier allows. `texel_size` 2 or 4 lets one texel cover 2×2 or 4×4 model pixels, for such a model only.
 */

const flat = { north: "#6688aa", east: "#557799", south: "#6688aa", west: "#557799", up: "#88aacc", down: "#446688" }
const clip = (name: string, loop: boolean) => ({ name, length: 1, loop, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [5, 0, 0] }] }] })
// Four slabs 200×40×200: their tops and bottoms alone are eight faces of 200×200, which no 512 sheet holds at a texel to a model pixel.
const giant = (texel?: 1 | 2 | 4) => ({
  name: "巨型",
  texture_size: 512,
  budget: "epic",
  ...(texel === undefined ? {} : { texel_size: texel }),
  bones: [
    {
      name: "body",
      parent: null,
      pivot: [0, 0, 0],
      rotation: [0, 0, 0],
      cubes: [0, 1, 2, 3].map((index) => ({ name: `slab_${index}`, origin: [-100, index * 50, -100], size: [200, 40, 200], faces: flat, surface_details: [] })),
    },
  ],
  animations: [clip("idle", true), clip("walk", true), clip("hurt", false)],
})
const small = (texel?: 1 | 2 | 4) => ({ ...giant(texel), budget: "epic", bones: [{ ...giant().bones[0]!, cubes: [{ name: "box", origin: [-4, 0, -4], size: [8, 8, 8], faces: flat, surface_details: [] }] }] })

test("a model that names no texel size is laid out and painted exactly as before", () => {
  const plain = ModelDesignSchema.parse(small())
  const one = ModelDesignSchema.parse(small(1))
  expect("texel_size" in plain).toBe(false)
  expect(JSON.stringify(modelAtlas(plain))).toBe(JSON.stringify(modelAtlas(one)))
  expect(Buffer.from(paintModel(plain).pixels).equals(Buffer.from(paintModel(one).pixels))).toBe(true)
  expect(faceSize([7, 5, 3], "up")).toEqual([7, 3])
  expect(faceSize([7, 5, 3], "up", 2)).toEqual([4, 2])
  expect(faceSize([7, 5, 3], "east", 4)).toEqual([1, 2])
})

test("a giant that no 512 sheet holds fits at two model pixels to a texel, its faces counted in texels", () => {
  expect(() => modelAtlas(giant() as never)).toThrow(TEXTURE_SPACE_ERROR)
  expect(TEXTURE_SPACE_ERROR).toContain("texel_size: 2 或 4")
  const design = ModelDesignSchema.parse(giant(2))
  const islands = modelAtlas(design)
  const top = islands.find((island) => island.cube === "slab_0" && island.face === "up")!
  expect([top.width, top.height]).toEqual([100, 100])
  const painted = paintModel(design)
  expect(painted.size).toBe(512)
  // Every island and its one-texel ring lie inside the sheet.
  expect(islands.every((island) => island.x >= 1 && island.y >= 1 && island.x + island.width + 1 <= 512 && island.y + island.height + 1 <= 512)).toBe(true)
})

test("a coarser texel than the model needs is refused with the size that does hold it", () => {
  const four = ModelDesignSchema.safeParse(giant(4))
  expect(four.success).toBe(false)
  expect(four.error!.issues.find((issue) => issue.path[0] === "texel_size")!.message).toContain("texel_size 4 用不着")
  const coarse = ModelDesignSchema.safeParse(small(2))
  expect(coarse.success).toBe(false)
  expect(coarse.error!.issues.find((issue) => issue.path[0] === "texel_size")!.message).toContain("改成 1（或者不写）")
  expect(ModelDesignSchema.safeParse({ ...giant(), texel_size: 3 }).success).toBe(false)
})

test("surface details of a model at two model pixels to a texel stay inside the face as counted in texels", () => {
  const withDetail = (x: number) => {
    const design = giant(2)
    design.bones[0]!.cubes[0]!.surface_details = [{ face: "up", x, y: 0, width: 2, height: 2, color: "#ffffff" }] as never
    return ModelDesignSchema.safeParse(design)
  }
  expect(withDetail(98).success).toBe(true)
  expect(withDetail(99).success).toBe(false)
})

test("a script may write texel_size: its faces, canvases and the document follow it", () => {
  const made = scriptApi({ wears: null, limits: SCRIPT_LIMITS })
  const api = made.api
  const m = api.model({ name: "巨型", texture_size: 512, budget: "epic", texel_size: 2 })
  expect(api.faceSize([200, 40, 200], "up", 2)).toEqual([100, 100])
  expect(() => api.faceSize([200, 40, 200], "up", 3)).toThrow("texel_size：1、2 或 4")
  const body = m.bone("body")
  // A canvas the size of the face in model pixels is refused; one the size in texels is taken.
  expect(() => body.cube("wrong", { origin: [-100, 0, -100], size: [200, 40, 200], color: "#6688aa", draw: { up: api.canvas(200, 200) } })).toThrow("texel_size 2")
  ;[0, 1, 2, 3].forEach((index) => body.cube(`slab_${index}`, { origin: [-100, index * 50, -100], size: [200, 40, 200], color: "#6688aa", ...(index === 0 ? { draw: { up: api.canvas(100, 100) } } : {}) }))
  ;["idle", "walk", "hurt"].forEach((name) => m.animation(name, { length: 1, loop: name !== "hurt" }).key("body", 0, [0, 0, 0]))
  const result = JSON.parse(made.finish(m)) as { value: Record<string, unknown> }
  expect(result.value.texel_size).toBe(2)
  const { kind: _kind, ...document } = result.value
  const parsed = ModelDesignSchema.safeParse(document)
  expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)).toEqual([])
  expect(() => api.model({ name: "x", texel_size: 3 })).toThrow("texel_size 只能是 1、2 或 4")
})

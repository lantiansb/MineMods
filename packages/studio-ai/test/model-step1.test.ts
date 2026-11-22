import { expect, test } from "bun:test"
import { ModelDesignSchema, ModelDesignJsonSchema, type ModelDesign } from "../src/contracts"
import { GEOMETRY_TIERS, scriptTier, textureSizes } from "../src/budget"
import { geoCube, modelAtlas, paintFlatness, paintFlatnessLine, paintModel, usesPaint } from "../src/model-paint"
import { measureLook } from "../src/model-look"
import { placedCubes } from "../src/model-space"
import { EPIC_MODEL_GUIDE, MODEL_ART_DIRECTION, MODEL_SHAPE_GUIDE, modelComplexityInstructions } from "../src/model-quality"
import { SCRIPT_API, SCRIPT_LIMITS, scriptApi } from "../src/script"
import { designFixture } from "./fixture"

/**
 * 第 1 步 (modelling and painting to the measure of a large hand-painted boss): a cube may be turned about its own pivot, grown, mirrored and
 * may wear another cube's texture; faces can be laid tallest first; the epic tier has a 1024 texture and longer scripts; a model can be painted
 * rich (light, edges, seams, the material's wear) and its faces pixel by pixel; how flat a texture is, is measured and said.
 */

const flat = (color: string) => ({ north: color, east: color, south: color, west: color, up: color, down: color })
const clips = (bone: string) => ["idle", "walk", "hurt"].map((name) => ({ name, length: 1, loop: name !== "hurt", channels: [{ bone, keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [10, 0, 0] }] }] }))
type CubeIn = Record<string, unknown> & { name: string; origin: number[]; size: number[] }
const model = (cubes: CubeIn[], extra: Record<string, unknown> = {}) =>
  ({ name: "plates", texture_size: 64, ...extra, bones: [{ name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: cubes.map((cube) => ({ faces: flat("#808080"), surface_details: [], ...cube })) }], animations: clips("root") }) as unknown
const parse = (value: unknown) => ModelDesignSchema.safeParse(value)
const issues = (value: unknown) => (parse(value).error?.issues ?? []).map((issue) => issue.message).join("\n")

test("a cube may say rotation, pivot, inflate, mirror and share; one that says none is the cube it was", () => {
  const turned = parse(model([{ name: "plate", origin: [0, 0, 0], size: [8, 1, 4], rotation: [0, 22.5, -37], pivot: [0, 0.5, 2], inflate: 0.25, mirror: true }]))
  expect(turned.success).toBe(true)
  expect(parse(model([{ name: "plate", origin: [0, 0, 0], size: [8, 1, 4], rotation: [0, 190, 0] }])).success).toBe(false)
  expect(parse(model([{ name: "plate", origin: [0, 0, 0], size: [8, 1, 4], inflate: 5 }])).success).toBe(false)
  // Every new key is nullable, so strict JSON-schema callers can send null for "none".
  expect(parse(model([{ name: "plate", origin: [0, 0, 0], size: [8, 1, 4], rotation: null, pivot: null, inflate: null, mirror: null, share: null, pixels: null }], { shading: null, atlas: null })).success).toBe(true)
  const cube = (ModelDesignJsonSchema as { properties: { bones: { items: { properties: { cubes: { items: { required: string[] } } } } } } }).properties.bones.items.properties.cubes.items
  expect(cube.required).toEqual(expect.arrayContaining(["rotation", "pivot", "inflate", "mirror", "share", "pixels"]))
  // An old cube compiles to exactly what it did: origin, size and uv, nothing else.
  const old = designFixture()
  expect(Object.keys(geoCube(old.bones[0]!.cubes[0]!, modelAtlas(old).filter((island) => island.cubeIndex === 0 && island.boneIndex === 0)))).toEqual(["origin", "size", "uv"])
  const design = turned.data as ModelDesign
  const written = geoCube(design.bones[0]!.cubes[0]!, modelAtlas(design))
  expect(written).toMatchObject({ inflate: 0.25, pivot: [0, 0.5, 2], rotation: [0, 22.5, -37] })
  // Mirrored: every face's place runs backwards.
  expect(written.uv.north.uv_size[0]).toBeLessThan(0)
  expect(written.uv.north.uv[0]! + written.uv.north.uv_size[0]!).toBe(modelAtlas(design).find((island) => island.face === "north")!.x)
})

test("share: the right side wears the left side's texture, mirrored with east and west swapped, and takes no texture of its own; what cannot be shared is said", () => {
  const left = { name: "arm_l", origin: [4, 0, 0], size: [3, 8, 2] }
  const design = parse(model([left, { name: "arm_r", origin: [-7, 0, 0], size: [3, 8, 2], share: "root.arm_l", mirror: true }])).data as ModelDesign
  const islands = modelAtlas(design)
  const of = (cube: string, face: string) => islands.find((island) => island.cube === cube && island.face === face)!
  expect(of("arm_r", "north")).toMatchObject({ x: of("arm_l", "north").x, y: of("arm_l", "north").y, flip: true, shared: true })
  expect(of("arm_r", "east")).toMatchObject({ x: of("arm_l", "west").x, y: of("arm_l", "west").y })
  expect(of("arm_r", "west")).toMatchObject({ x: of("arm_l", "east").x })
  // The texture is the same as the left arm's alone: the shared cube paints nothing.
  const alone = paintModel(parse(model([left])).data as ModelDesign)
  expect(Buffer.from(paintModel(design).pixels).equals(Buffer.from(alone.pixels))).toBe(true)
  expect(issues(model([left, { name: "arm_r", origin: [-7, 0, 0], size: [3, 9, 2], share: "root.arm_l" }]))).toContain("不一样大")
  expect(issues(model([left, { name: "arm_r", origin: [-7, 0, 0], size: [3, 8, 2], share: "root.nothing" }]))).toContain("模型里没有")
  expect(issues(model([left, { name: "arm_r", origin: [-7, 0, 0], size: [3, 8, 2], share: "root.arm_l", surface_details: [{ face: "north", x: 0, y: 0, width: 1, height: 1, color: "#000000" }] }]))).toContain("不会画出来")
  expect(issues(model([{ ...left, share: "root.arm_r" }, { name: "arm_r", origin: [-7, 0, 0], size: [3, 8, 2], share: "root.arm_l" }]))).toContain("自己也是借别人的贴图")
})

test("atlas packed lays the faces tallest first and needs far less texture; rows is what every saved texture has", () => {
  const cubes = Array.from({ length: 30 }, (_, index) => ({ name: `c${index}`, origin: [0, index * 2, 0], size: [1 + (index % 5) * 3, 1 + ((index * 7) % 11), 2 + (index % 3)] }))
  const rows = parse(model(cubes, { texture_size: 256 })).data as ModelDesign
  const packed = parse(model(cubes, { texture_size: 256, atlas: "packed" })).data as ModelDesign
  const height = (design: ModelDesign) => Math.max(...modelAtlas(design).map((island) => island.y + island.height))
  expect(height(packed)).toBeLessThan(height(rows) * 0.8)
  // No two islands of the packed layout overlap, ring included.
  const islands = modelAtlas(packed)
  for (const a of islands) for (const b of islands) if (a !== b) expect(a.x + a.width + 1 <= b.x - 1 || b.x + b.width + 1 <= a.x - 1 || a.y + a.height + 1 <= b.y - 1 || b.y + b.height + 1 <= a.y - 1 || a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y).toBe(true)
  expect(modelAtlas(rows)).toEqual(modelAtlas({ ...rows, atlas: "rows" }))
})

test("the epic tier has a 1024 texture and its scripts six seconds; a model saved with texel_size 2 at 512 stays valid; a script's own canvas stays 512", () => {
  expect(textureSizes("epic")).toEqual([64, 128, 256, 512, 1024])
  expect(textureSizes("finest")).toEqual([64, 128, 256, 512])
  expect(GEOMETRY_TIERS.epic.script_seconds).toBe(6)
  expect(GEOMETRY_TIERS.standard.script_seconds).toBe(SCRIPT_LIMITS.seconds)
  expect(SCRIPT_LIMITS.canvas).toBe(512)
  expect(scriptTier('const m = api.model({ name: "x", budget: "epic", texture_size: 1024 })')).toBe("epic")
  expect(scriptTier('const m = api.model({ name: "x" })')).toBe("standard")
  expect(scriptTier("// budget: 'nonsense'")).toBe("standard")
  // A giant 200 pixels a side: at texel 2 on 512 it was the only way; it still parses. At 1024 and texel 2 it is refused, 1024 holds it at one.
  const giant = (extra: Record<string, unknown>) => model([0, 1, 2, 3].map((index) => ({ name: `slab_${index}`, origin: [-100, index * 50, -100], size: [200, 40, 200] })), { budget: "epic", ...extra })
  expect(parse(giant({ texture_size: 512, texel_size: 2 })).success).toBe(true)
  expect(issues(giant({ texture_size: 1024, texel_size: 2 }))).toContain("texel_size 2 用不着")
  expect(parse(giant({ texture_size: 1024 })).success).toBe(true)
  expect(issues(giant({ texture_size: 1024, budget: "finest" }))).toContain("贴图超出了「最精细」档的上限")
})

test("pixels: only the finest and the epic tiers; the face's size exactly; drawn as written", () => {
  const face = { palette: ["#112233", "#ddeeff"], data: [0, 1, 1, 0, 1, 0, 0, 1] }
  const painted = (budget: string | null, data = face) => model([{ name: "skull", origin: [0, 0, 0], size: [4, 2, 3], pixels: { north: data } }], { budget })
  expect(issues(painted(null))).toContain("只有「最精细」「史诗」档可以")
  expect(issues(painted("epic", { ...face, data: [0, 1] }))).toContain("这个面是 4×2=8 个")
  expect(issues(painted("epic", { ...face, data: [0, 1, 2, 0, 1, 0, 0, 1] }))).toContain("超出 palette")
  const design = parse(painted("finest")).data as ModelDesign
  expect(usesPaint(design)).toBe(true)
  const out = paintModel(design)
  const north = out.islands.find((island) => island.face === "north")!
  const at = (u: number, v: number) => [...out.pixels.slice(((north.y + v) * out.size + north.x + u) * 4, ((north.y + v) * out.size + north.x + u) * 4 + 3)]
  expect([at(0, 0), at(1, 0), at(0, 1)]).toEqual([[0x11, 0x22, 0x33], [0xdd, 0xee, 0xff], [0xdd, 0xee, 0xff]])
})

test("rich shading: light by direction, a lit top edge, a dark seam where another part presses, each material its own wear; the same every time; flat is as before", () => {
  const parts = [
    { name: "body", origin: [-6, 0, -4], size: [12, 12, 8], paint: { material: "stone", base: "#7a7468" } },
    { name: "plate", origin: [-5, 4, -5], size: [10, 6, 1], paint: { material: "metal", base: "#8e959c", wear: 0.8 } },
  ]
  const plain = parse(model(parts, { budget: "epic" })).data as ModelDesign
  const rich = { ...plain, shading: "rich" as const }
  const a = paintModel(rich)
  expect(Buffer.from(paintModel(rich).pixels).equals(Buffer.from(a.pixels))).toBe(true)
  expect(Buffer.from(paintModel({ ...plain, shading: "flat" }).pixels).equals(Buffer.from(paintModel(plain).pixels))).toBe(true)
  const flatness = { before: paintFlatness(plain), after: paintFlatness(rich) }
  expect(flatness.after.ratio).toBeLessThan(flatness.before.ratio)
  expect(flatness.after.ratio).toBeLessThan(0.3)
  const island = (cube: string, face: string) => a.islands.find((value) => value.cube === cube && value.face === face)!
  const light = (cube: string, face: string, u: number, v: number) => ((x) => (a.pixels[x]! * 299 + a.pixels[x + 1]! * 587 + a.pixels[x + 2]! * 114) / 1000)(((island(cube, face).y + v) * a.size + island(cube, face).x + u) * 4)
  const mean = (cube: string, face: string) => {
    const at = island(cube, face)
    let sum = 0
    for (let v = 0; v < at.height; v++) for (let u = 0; u < at.width; u++) sum += light(cube, face, u, v)
    return sum / (at.width * at.height)
  }
  // Light from above: the top is brighter than the sides, the bottom darkest.
  expect(mean("body", "up")).toBeGreaterThan(mean("body", "east"))
  expect(mean("body", "east")).toBeGreaterThan(mean("body", "down"))
  // The front of the body behind the plate is pressed: darker than its open rim.
  const front = island("body", "north")
  const behind = light("body", "north", Math.floor(front.width / 2), 6)
  const open = light("body", "north", Math.floor(front.width / 2), front.height - 2)
  expect(behind).toBeLessThan(open)
  // Rust: the worn metal plate has reddish texels, stone does not get them.
  const reddish = (cube: string) => {
    const at = island(cube, "north")
    let count = 0
    for (let v = 0; v < at.height; v++)
      for (let u = 0; u < at.width; u++) {
        const x = ((at.y + v) * a.size + at.x + u) * 4
        if (a.pixels[x]! > a.pixels[x + 2]! + 12) count++
      }
    return count
  }
  expect(reddish("plate")).toBeGreaterThan(0)
  expect(paintFlatnessLine(rich, flatness.after)).toContain("平涂占比")
  expect(paintFlatnessLine(plain, flatness.before)).toContain("没有写 shading")
})

test("every material paints differently under rich shading, leather among them", () => {
  const materials = ["skin", "fur", "feather", "scales", "shell", "stone", "crystal", "metal", "wood", "cloth", "bone", "slime", "leaf", "leather"]
  const patterns = materials.map((material) => {
    const design = parse(model([{ name: "slab", origin: [0, 0, 0], size: [12, 12, 12], paint: { material, base: "#808080" } }], { shading: "rich" })).data as ModelDesign
    const out = paintModel(design)
    const at = out.islands.find((island) => island.face === "north")!
    return Array.from({ length: at.height }, (_, v) => Array.from({ length: at.width }, (_, u) => out.pixels[((at.y + v) * out.size + at.x + u) * 4]).join(",")).join("|")
  })
  expect(new Set(patterns).size).toBe(materials.length)
})

test("turned and grown cubes are measured where they are drawn", () => {
  const upright = parse(model([{ name: "plate", origin: [0, 0, 0], size: [16, 1, 1] }])).data as ModelDesign
  const turned = parse(model([{ name: "plate", origin: [0, 0, 0], size: [16, 1, 1], rotation: [0, 0, 90], pivot: [0, 0.5, 0.5] }])).data as ModelDesign
  const box = (design: ModelDesign) => placedCubes(design)[0]!
  expect(box(upright).max[1] - box(upright).min[1]).toBeCloseTo(1, 5)
  expect(box(turned).max[1] - box(turned).min[1]).toBeCloseTo(16, 5)
  expect(box(parse(model([{ name: "plate", origin: [0, 0, 0], size: [16, 1, 1], inflate: 1 }])).data as ModelDesign).max[1]).toBeCloseTo(2, 5)
  expect(measureLook(turned).height).toBeGreaterThan(measureLook(upright).height * 4)
})

test("the guide says what a cube may say and what a boss is made to; the 16-64 range is not for a boss", () => {
  for (const word of ["rotation", "pivot", "inflate", "mirror", "share", "atlas", "packed", "1024"]) expect(MODEL_SHAPE_GUIDE).toContain(word)
  expect(MODEL_ART_DIRECTION).toContain(MODEL_SHAPE_GUIDE)
  expect(MODEL_ART_DIRECTION).toContain('shading: \\"rich\\"'.replaceAll("\\", ""))
  expect(MODEL_ART_DIRECTION).toContain("pixels")
  expect(EPIC_MODEL_GUIDE).toContain("60–120")
  expect(EPIC_MODEL_GUIDE).toContain("8–13")
  expect(EPIC_MODEL_GUIDE).toContain("平涂占比")
  expect(modelComplexityInstructions("high")).toContain("Boss 和史诗档的模型不按它")
  expect(modelComplexityInstructions("medium")).not.toContain("Boss")
  expect(SCRIPT_API.find((entry) => entry[0].startsWith("bone.cube"))![0]).toContain("rotation")
})

test("a script turns, grows and shares cubes; m.mirror with share makes the other side wear this one's texture; an epic face drawn on a canvas is kept pixel for pixel", () => {
  const made = scriptApi({ wears: null, limits: SCRIPT_LIMITS })
  const { api } = made
  const m = api.model({ name: "warden", budget: "epic", texture_size: 128, shading: "rich", atlas: "packed" })
  const root = m.bone("root")
  const arm = m.bone("arm_left", { parent: "root", pivot: [6, 10, 0] })
  arm.cube("plate", { origin: [5, 6, -2], size: [4, 6, 4], color: "#808080", rotation: [0, 0, -20], pivot: [6, 10, 0], inflate: 0.5 })
  const c = api.canvas(6, 6, "#404040")
  c.set(1, 1, "#ff0000")
  c.set(2, 3, "#00ff00")
  c.set(4, 4, "#0000ff")
  for (let x = 0; x < 6; x++) c.set(x, 5, x % 2 ? "#111111" : "#222222")
  root.cube("skull", { origin: [-3, 10, -3], size: [6, 6, 6], color: "#808080", draw: { north: c } })
  m.mirror("arm_left", { from: "_left", to: "_right", share: true })
  ;["idle", "walk", "hurt"].forEach((name) => m.animation(name, { length: 1, loop: name !== "hurt" }).key("root", 0, [0, 0, 0]))
  const out = JSON.parse(made.finish(m)) as { value: Record<string, unknown> & ModelDesign }
  const { kind: _kind, ...rest } = out.value as Record<string, unknown>
  const design = ModelDesignSchema.parse(rest)
  expect(design.shading).toBe("rich")
  expect(design.atlas).toBe("packed")
  const left = design.bones.find((bone) => bone.name === "arm_left")!.cubes[0]!
  const right = design.bones.find((bone) => bone.name === "arm_right")!.cubes[0]!
  expect(left).toMatchObject({ rotation: [0, 0, -20], pivot: [6, 10, 0], inflate: 0.5 })
  expect(right).toMatchObject({ rotation: [0, 0, 20], pivot: [-6, 10, 0], inflate: 0.5, share: "arm_left.plate", mirror: true })
  const skull = design.bones.find((bone) => bone.name === "root")!.cubes[0]!
  expect(skull.surface_details).toEqual([])
  expect(skull.pixels?.north?.data.length).toBe(36)
  expect(new Set(skull.pixels!.north!.palette).size).toBe(6)
})

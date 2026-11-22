import { expect, test } from "bun:test"
import { ModelDesignSchema } from "../src/contracts"
import { PICTURE_GUIDE } from "../src/making"
import { MODEL_ART_DIRECTION, TEXTURE_ART_DIRECTION } from "../src/model-quality"
import { ORIENTATION_GUIDE, innerFace, outerFace } from "../src/orientation"
import { SCRIPT_API, SCRIPT_DENIED, SCRIPT_ERRORS, SCRIPT_EXAMPLE, SCRIPT_GUIDE, SCRIPT_LIMITS, SCRIPT_SUMMARY, scriptApi } from "../src/script"
import { GEOMETRY_TIERS } from "../src/budget"
import { STRUCTURE_GUIDE, STRUCTURE_GUIDE_TITLE } from "../src/structure-guide"

// The API is called directly here, outside any sandbox: these tests are about what the medium offers and
// what it refuses to know. Running a script shut away is tested where the sandbox lives (mod-core).

const kit = () => scriptApi({ wears: null, limits: SCRIPT_LIMITS })
const run = (body: (api: ReturnType<typeof kit>["api"]) => unknown) => {
  const made = kit()
  return JSON.parse(made.finish(body(made.api))) as { value: Record<string, unknown> | null; notes: string[] }
}
const lit = { north: "#808080", east: "#808080", south: "#808080", west: "#808080", up: "#808080", down: "#808080" }
const motions = (m: ReturnType<ReturnType<typeof kit>["api"]["model"]>, bone: string) => ["idle", "walk", "hurt"].forEach((name) => m.animation(name, { length: 1, loop: name !== "hurt" }).key(bone, 0, [0, 0, 0]))

/** Every name a script can call, by walking what the API hands out. */
function surface() {
  const api = kit().api
  const m = api.model({ name: "surface" })
  const bone = m.bone("root")
  const canvas = api.canvas(4, 4)
  return {
    api: Object.keys(api),
    m: Object.keys(m),
    bone: Object.keys(bone),
    a: Object.keys(m.animation("idle", { length: 1, loop: true })),
    alone: Object.keys(api.animation({ name: "wave", length: 1, loop: false })),
    c: Object.keys(canvas),
    random: Object.keys(api.random(1)),
  }
}

/** A name in the words it is made of: `texture_size` and `faceSize` are two words each. */
const words = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/).filter(Boolean)

test("API 的每一个名字和每一个选项里都没有题材的词：它只懂骨骼、方块、关键帧、像素和几何", () => {
  const names = Object.values(surface()).flat()
  // Options are read off the implementation itself, so one added later is checked without anyone remembering to.
  const options = [...scriptApi.toString().matchAll(/\b(?:given|asked|look)\.([A-Za-z_]\w*)/g)].map((match) => match[1]!)
  const documented = SCRIPT_API.flatMap((entry) => [...entry[0].matchAll(/[A-Za-z_]\w*/g)].map((match) => match[0]))
  const denied = new Set<string>(SCRIPT_DENIED)
  const found = [...names, ...options, ...documented].filter((name) => words(name).some((word) => denied.has(word)))
  expect(found).toEqual([])
  expect(options.length).toBeGreaterThan(20)
  // No call is a ready-made part: nothing on the surface makes more than one bone or cube without being given every size.
  expect(names).not.toContain("preset")
  expect(SCRIPT_DENIED).toEqual(expect.arrayContaining(["leg", "wing", "tail", "head", "creature", "quadruped", "preset", "template", "proportions"]))
})

test("说明里列的和实际能用的是同一批：多一个少一个都不行", () => {
  const made = surface()
  const listed = (prefix: string) => [...new Set(SCRIPT_API.flatMap((entry) => [...entry[0].matchAll(new RegExp(`(?:^|[\\s/])${prefix}\\.([A-Za-z]+)`, "g"))].map((match) => match[1]!)))].sort()
  expect(listed("api")).toEqual([...made.api].sort())
  expect(listed("m")).toEqual(made.m.filter((name) => name !== "name").sort())
  expect(listed("bone")).toEqual([...made.bone].sort())
  expect(listed("a")).toEqual(made.a.filter((name) => !["name", "length"].includes(name)).sort())
  expect(listed("c")).toEqual(made.c.filter((name) => !["width", "height"].includes(name)).sort())
  expect(made.alone).toEqual([...made.a, "document"])
  expect(made.random.sort()).toEqual(["between", "pick", "whole"])
  // The guide carries the whole list, the limits and the example; the summary says both ways are equal.
  SCRIPT_API.forEach((entry) => expect(SCRIPT_GUIDE).toContain(entry[0]))
  expect(SCRIPT_GUIDE).toContain(SCRIPT_EXAMPLE)
  expect(SCRIPT_GUIDE).toContain(`${SCRIPT_LIMITS.cubes} 个方块`)
  expect(SCRIPT_SUMMARY).toContain("两种交法是平等的")
})

test("示范脚本故意不是任何具体的东西，跑出来是一份合格的模型文档", () => {
  const made = kit()
  const value = JSON.parse(made.finish(new Function("api", `"use strict";${SCRIPT_EXAMPLE}`)(made.api))).value
  const design = ModelDesignSchema.parse((({ kind: _kind, ...rest }) => rest)(value))
  expect(value.kind).toBe("model")
  expect(design.bones).toHaveLength(6)
  expect(design.bones.flatMap((bone) => bone.cubes)).toHaveLength(6)
  expect(design.animations.map((motion) => motion.name)).toEqual(["idle", "walk", "hurt"])
  // The example's own words name no subject either.
  const denied = new Set<string>(SCRIPT_DENIED.filter((word) => !["idle", "walk"].includes(word)))
  expect(words(SCRIPT_EXAMPLE.replace(/[^\x00-\x7f]/g, " ")).filter((word) => denied.has(word))).toEqual([])
})

test("脚本写出来的和手写的是同一份文档：一个字段都不差", () => {
  const again = run((api) => {
    const m = api.model({ name: "两根柱子", texture_size: 64 })
    const base = m.bone("base", { pivot: [0, 0, 0] })
    ;[-4, 4].forEach((x, index) => base.bone(`post_${index + 1}`, { pivot: [x, 0, 0], rotation: [0, 0, index ? -10 : 10] }).cube("shaft", { origin: [x - 1, 0, -1], size: [2, 8, 2], color: "#808080" }))
    base.cube("slab", { center: [0, 0.5, 0], size: [12, 1, 4], faces: { ...lit, up: "#a0a0a0" } })
    motions(m, "base")
    return m
  })
  const cube = (name: string, origin: number[], size: number[], faces = lit) => ({ name, origin, size, faces, surface_details: [] })
  expect(again.value).toEqual({
    kind: "model",
    name: "两根柱子",
    texture_size: 64,
    bones: [
      { name: "base", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [cube("slab", [-6, 0, -2], [12, 1, 4], { ...lit, up: "#a0a0a0" })] },
      { name: "post_1", parent: "base", pivot: [-4, 0, 0], rotation: [0, 0, 10], cubes: [cube("shaft", [-5, 0, -1], [2, 8, 2])] },
      { name: "post_2", parent: "base", pivot: [4, 0, 0], rotation: [0, 0, -10], cubes: [cube("shaft", [3, 0, -1], [2, 8, 2])] },
    ],
    animations: ["idle", "walk", "hurt"].map((name) => ({ name, length: 1, loop: name !== "hurt", channels: [{ bone: "base", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] })),
  })
  expect(() => ModelDesignSchema.parse((({ kind: _kind, ...rest }) => rest)(again.value!))).not.toThrow()
})

test("几何是对的：world 和 rest 互为反算，mirror 是真的左右对称，chain 的关节落在给的点上", () => {
  const api = kit().api
  const m = api.model({ name: "几何" })
  const root = m.bone("root", { pivot: [0, 10, 0], rotation: [0, 30, 0] })
  const arm = root.bone("side_r", { pivot: [5, 12, 1], rotation: [20, 0, -40] })
  const tip = arm.bone("side_r_tip", { pivot: [11, 12, 1], rotation: [0, 0, 25] })
  tip.cube("box", { origin: [11, 11, 0], size: [4, 2, 2], color: "#808080" })
  const point = [13, 12.5, 1.5]
  const world = m.world("side_r_tip", point)
  m.rest("side_r_tip", world).forEach((value, axis) => expect(value).toBeCloseTo(point[axis]!, 2))
  // A rotation leaves a joint's own pivot where it is.
  m.world("root", [0, 10, 0]).forEach((value, axis) => expect(value).toBeCloseTo([0, 10, 0][axis]!, 5))
  const names = m.mirror("side_r", { from: "_r", to: "_l" }) as Record<string, string>
  expect(names).toEqual({ side_r: "side_l", side_r_tip: "side_l_tip" })
  // Under an unturned parent the mirrored point is the mirror image; here the root is turned, so compare inside its frame.
  const inRoot = (bone: string, at: number[]) => m.rest("root", m.world(bone, at))
  const right = inRoot("side_r_tip", point)
  const left = inRoot("side_l_tip", api.mirror(point))
  expect(left[0]).toBeCloseTo(-right[0]!, 2)
  expect(left[1]).toBeCloseTo(right[1]!, 2)
  expect(left[2]).toBeCloseTo(right[2]!, 2)

  const line = api.curve([[0, 20, 0], [0, 26, -6], [0, 28, -14], [0, 24, -20]], 5)
  expect(line).toHaveLength(6)
  const chained = m.chain("link", { parent: "root", points: line, sizes: (index: number) => [4 - Math.floor(index / 2), 3], color: "#808080" }) as { name: string; pivot: number[] }[]
  expect(chained.map((bone) => bone.name)).toEqual(["link_1", "link_2", "link_3", "link_4", "link_5"])
  chained.forEach((bone, index) => m.world(bone.name, [...bone.pivot]).forEach((value, axis) => expect(value).toBeCloseTo(line[index]![axis]!, 1)))
  // joint: said by where it ends up.
  const placed = m.joint("perch", { parent: "link_5", at: [3, 30, -10], toward: [3, 40, -10], along: "y+" })
  m.world("perch", [...placed.pivot]).forEach((value, axis) => expect(value).toBeCloseTo([3, 30, -10][axis]!, 1))
  m.world("perch", api.add(placed.pivot, [0, 5, 0])).forEach((value, axis) => expect(value).toBeCloseTo([3, 35, -10][axis]!, 1))
  expect(m.count()).toEqual({ bones: 11, cubes: 7, animations: 0 })
})

test("outer 和 inner 是几何：按方块落在中线哪一边换成 west 或 east；跨在中线上的说清楚并拒绝", () => {
  const faces = (origin: [number, number, number], rotation: [number, number, number] = [0, 0, 0], side: Record<string, string> = { outer: "#ff00ff", inner: "#00ff00" }) => {
    const made = run((api) => {
      const m = api.model({ name: "sides" })
      m.bone("root").bone("part", { pivot: [0, 0, 0], rotation }).cube("box", { origin, size: [2, 2, 2], color: "#808080", faces: side, details: [{ face: "outer", x: 0, y: 0, width: 1, height: 1, color: "#ffffff" }] })
      motions(m, "root")
      return m.document()
    })
    const cube = ModelDesignSchema.parse((({ kind: _kind, ...design }) => design)(made.value!)).bones[1]!.cubes[0]!
    return { outer: Object.entries(cube.faces).find((entry) => entry[1] === "#ff00ff")![0], inner: Object.entries(cube.faces).find((entry) => entry[1] === "#00ff00")![0], detail: cube.surface_details[0]!.face }
  }
  // Its own left is +X, and the face that points that way is west.
  expect(faces([5, 0, 0])).toEqual({ outer: "west", inner: "east", detail: "west" })
  expect(faces([-7, 0, 0])).toEqual({ outer: "east", inner: "west", detail: "east" })
  expect([outerFace(6), outerFace(-6), outerFace(0), innerFace(6)]).toEqual(["west", "east", null, "east"])
  // A bone turned half way round carries the box to the other side and its faces with it.
  expect(faces([5, 0, -1], [0, 180, 0]).outer).toBe("west")
  expect(() => faces([-1, 0, 0])).toThrow("跨在中线（x=0）上，没有内外之分")
  expect(() => faces([5, 0, 0], [0, 90, 0])).toThrow("已经不朝两侧了")
  expect(() => faces([5, 0, 0], [0, 0, 0], { outer: "#ff00ff", west: "#00ff00" })).toThrow("west 面写了两次")
  for (const text of [SCRIPT_GUIDE, MODEL_ART_DIRECTION, TEXTURE_ART_DIRECTION, PICTURE_GUIDE]) expect(text).toContain("它自己的左边在 +X 一侧")
  expect(SCRIPT_GUIDE).toContain(ORIENTATION_GUIDE)
  expect(ORIENTATION_GUIDE).toContain("左侧部件（方块中心 x 大于 0）的外侧——背向身体中线 x=0 的那一面——是 west")
})

test("像素也是材料：画布画出贴图文档，或者画到方块的一个面上；同一个种子画出来一样", () => {
  const texture = run((api) => api.canvas(16, 16, "#203040").rect(2, 2, 4, 4, "#ffffff").line(0, 15, 15, 15, "#000000").gradient(8, 0, 8, 8, "#ff0000", "#0000ff", { steps: 4 }).noise(0, 8, 8, 6, ["#335533", "#447744", "#559955"], { seed: 7, cell: 3 }))
  expect(texture.value).toMatchObject({ kind: "texture", width: 16, height: 16 })
  const value = texture.value as { palette: string[]; pixels: number[] }
  expect(value.pixels).toHaveLength(256)
  expect(value.palette).toEqual(expect.arrayContaining(["#203040", "#ffffff", "#000000", "#ff0000", "#0000ff", "#447744"]))
  expect(value.palette.length).toBeLessThanOrEqual(12)
  const again = run((api) => api.canvas(16, 16, "#203040").rect(2, 2, 4, 4, "#ffffff").line(0, 15, 15, 15, "#000000").gradient(8, 0, 8, 8, "#ff0000", "#0000ff", { steps: 4 }).noise(0, 8, 8, 6, ["#335533", "#447744", "#559955"], { seed: 7, cell: 3 }))
  expect(again.value).toEqual(texture.value)

  const model = run((api) => {
    const m = api.model({ name: "画了一面" })
    const face = api.canvas(...(api.faceSize([6, 4, 2], "north") as [number, number]), "#808080").rect(1, 1, 2, 2, "#ffffff")
    m.bone("root").cube("box", { origin: [-3, 0, -1], size: [6, 4, 2], color: "#808080", draw: { north: face } })
    motions(m, "root")
    return m.document()
  })
  const cube = (model.value as { bones: { cubes: { faces: Record<string, string>; surface_details: unknown[] }[] }[] }).bones[0]!.cubes[0]!
  expect(cube.faces.north).toBe("#808080")
  expect(cube.surface_details).toEqual([{ face: "north", x: 1, y: 1, width: 2, height: 2, color: "#ffffff" }])
  const random = [kit().api.random("a"), kit().api.random("a"), kit().api.random("b")].map((next) => [next(), next(), next()])
  expect(random[0]).toEqual(random[1]!)
  expect(random[0]).not.toEqual(random[2]!)
})

test("越过上限的那一行就停下，用人话说清楚：骨骼、方块、关键帧、贴图、面上的色块", () => {
  const said = (body: (api: ReturnType<typeof kit>["api"]) => unknown) => {
    try {
      body(kit().api)
      return ""
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }
  expect(said((api) => Array.from({ length: SCRIPT_LIMITS.bones + 1 }, (_, index) => index).reduce((m, index) => (m.bone(`b${index}`), m), api.model({ name: "骨骼" })))).toBe(`骨骼太多了：「普通」档一个模型最多 ${SCRIPT_LIMITS.bones} 根，这是第 ${SCRIPT_LIMITS.bones + 1} 根。确实需要更多，就把 budget 写成 "fine"（「精细」档最多 ${GEOMETRY_TIERS.fine.bones} 根），并在部件说明的 budget 里写明为什么需要。`)
  expect(
    said((api) => {
      const m = api.model({ name: "方块" })
      Array.from({ length: 5 }, (_, at) => m.bone(`b${at}`)).forEach((bone) => Array.from({ length: SCRIPT_LIMITS.bone_cubes }, (_, index) => bone.cube(`c${index}`, { origin: [0, 0, 0], size: [1, 1, 1], color: "#808080" })))
    }),
  ).toStartWith(`方块太多了：「普通」档一个模型最多 ${SCRIPT_LIMITS.cubes} 个，这是第 ${SCRIPT_LIMITS.cubes + 1} 个。确实需要更多，就把 budget 写成 "fine"`)
  // A model that names a higher tier is stopped at that tier's limit instead, and the highest tier says there is none above it.
  const filled = (budget: string, cubes: number) =>
    said((api) => {
      const m = api.model({ name: "方块", budget })
      Array.from({ length: Math.ceil(cubes / 60) }, (_, at) => m.bone(`b${at}`)).forEach((bone, at) => Array.from({ length: Math.min(60, cubes - at * 60) }, (_, index) => bone.cube(`c${index}`, { origin: [0, 0, 0], size: [1, 1, 1], color: "#808080" })))
    })
  expect(filled("fine", GEOMETRY_TIERS.fine.cubes)).toBe("")
  expect(filled("fine", GEOMETRY_TIERS.fine.cubes + 1)).toStartWith(`方块太多了：「精细」档一个模型最多 ${GEOMETRY_TIERS.fine.cubes} 个，这是第 ${GEOMETRY_TIERS.fine.cubes + 1} 个。`)
  expect(filled("finest", GEOMETRY_TIERS.finest.cubes + 1)).toEndWith("这已经是最高的一档。")
  expect(said((api) => api.model({ name: "x", budget: "huge" }))).toContain("budget 只能是 standard、fine、finest、epic 之一")
  expect(said((api) => api.model({ name: "x", texture_size: 512 }))).toContain(`把 budget 写成 "fine"`)
  expect(said((api) => api.model({ name: "x", texture_size: 512, budget: "fine" }))).toBe("")
  expect(said((api) => api.model({ name: "x" }).bone("root").cube("c", { origin: [0, 0, 0], size: [1, 1.5, 1], color: "#808080" }))).toContain("1 到 256 之间的整数")
  expect(said((api) => api.model({ name: "x" }).bone("root").cube("c", { origin: [0, 0, 0], size: [1, 1, 1] }))).toContain("没有颜色")
  expect(said((api) => api.model({ name: "x" }).bone("2bad"))).toContain("英文字母开头")
  expect(said((api) => api.model({ name: "x", texture_size: 100 }))).toBe("texture_size 只能是 64、128 或 256（「普通」档）。")
  expect(said((api) => api.canvas(SCRIPT_LIMITS.canvas + 1, 4))).toContain(`1 到 ${SCRIPT_LIMITS.canvas} 之间的整数`)
  expect(said((api) => (api.model({ name: "x" }).bone("root"), api.animation({ name: "wave", length: 1, loop: false }).sample("root", () => [0, 0, 0], SCRIPT_LIMITS.keys + 1)))).toContain(`2 到 ${SCRIPT_LIMITS.keys} 之间的整数`)
  expect(
    said((api) => {
      const m = api.model({ name: "x" })
      m.bone("root")
      m.animation("idle", { length: 1, loop: true }).key("nobody", 0, [0, 0, 0])
    }),
  ).toContain("模型里还没有这根骨骼")
  expect(said((api) => api.model({ name: "x" }).document())).toBe("模型里一个方块都没有。")
  expect(
    said((api) => {
      const m = api.model({ name: "x" })
      m.bone("root").cube("c", { origin: [0, 0, 0], size: [1, 1, 1], color: "#808080" })
      m.animation("idle", { length: 1, loop: true }).key("root", 0, [0, 0, 0])
      return m.document()
    }),
  ).toContain("现在缺 walk、hurt")
  // A face drawn pixel by pixel in too many pieces is refused with what to do instead.
  expect(
    said((api) => {
      const face = api.canvas(16, 16, "#000000")
      Array.from({ length: 128 }, (_, index) => face.set(((index % 8) * 2 + (Math.floor(index / 8) % 2)) % 16, Math.floor(index / 8), "#ffffff"))
      api.model({ name: "x" }).bone("root").cube("c", { origin: [0, 0, 0], size: [16, 16, 1], color: "#000000", draw: { north: face } })
    }),
  ).toContain("太碎了")
  expect(SCRIPT_ERRORS.timeout).toContain(`${SCRIPT_LIMITS.seconds} 秒`)
  expect(SCRIPT_ERRORS.threw("x", 3)).toBe("脚本运行到第 3 行出错了：x")
})

test("API 冻结到底：脚本改不了它，也没法通过它往别处伸手", () => {
  const api = kit().api
  expect(Object.isFrozen(api)).toBe(true)
  expect(Object.isFrozen(api.model)).toBe(true)
  expect(Object.isFrozen(api.model({ name: "x" }))).toBe(true)
  expect(Object.isFrozen(api.canvas(2, 2))).toBe(true)
  expect(Object.isFrozen(api.random(1))).toBe(true)
  expect(() => {
    "use strict"
    ;(api as { model: unknown }).model = 1
  }).toThrow()
  // Nothing the API hands out is anything but plain data and its own functions.
  expect(Object.keys(api).filter((name) => !["function", "object"].includes(typeof (api as Record<string, unknown>)[name]))).toEqual([])
  expect(scriptApi.toString()).not.toMatch(/\b(require|process|globalThis|Date\b|Math\.random|fetch|setTimeout|import)\b/)
})

test("转动的正负写在给每个制作者的话里，和量测、渲染用的是同一种", async () => {
  const { posedCorners } = await import("../src/model-motion")
  const centre = (rotation: readonly number[], origin: readonly number[], size: readonly number[]) => {
    const bones = [{ name: "part", parent: null, pivot: [0, 10, 0], rotation: [0, 0, 0], cubes: [{ name: "c", origin, size, rotation: [0, 0, 0], pivot: [0, 0, 0], inflate: 0, faces: {} }] }]
    const clip = { name: "walk", length: 1, loop: true, channels: [{ bone: "part", keyframes: [{ time: 0, rotation }, { time: 1, rotation }] }] }
    const corners = posedCorners({ bones } as never, clip as never, 0)
    return [0, 1, 2].map((axis) => corners.reduce((sum, point) => sum + point[axis]!, 0) / corners.length)
  }
  const hanging = [[-1, 0, -1], [2, 10, 2]] as const
  const reaching = [[-1, 9, -9], [2, 2, 8]] as const
  // x: what hangs under the pivot goes back (+Z), what reaches forward dips.
  expect(centre([30, 0, 0], ...hanging)[2]).toBeGreaterThan(1)
  expect(centre([-30, 0, 0], ...hanging)[2]).toBeLessThan(-1)
  expect(centre([30, 0, 0], ...reaching)[1]).toBeLessThan(9)
  // y: it turns to its own right. z: what hangs goes to its own right. posedCorners' frame mirrors x (a part at the document's +X, the
  // creature's own left, comes out at negative x), so positive x here is its right; this test read it the other way until 10-13.
  expect(centre([0, 30, 0], ...reaching)[0]).toBeGreaterThan(1)
  expect(centre([0, 0, 30], ...hanging)[0]).toBeGreaterThan(1)
  expect(ORIENTATION_GUIDE).toContain("往下垂的肢体 x 为负是往前伸，为正是往后摆")
  expect(ORIENTATION_GUIDE).toContain("绕 y 轴转正的角度，是朝它自己的右边（-X）转")
})

test("bone.solid 按参数生成 CAD 式的基本体：按像素格取样再并成尽量少的方块，左右对称的形状还是对称的，方块照常算预算", () => {
  const made = (shape: Record<string, unknown>) => {
    const m = kit().api.model({ name: "solid" })
    const root = m.bone("root")
    const used = m.solid("root", "s", { color: "#808080", ...shape })
    motions(m, "root")
    const cubes = (JSON.parse(JSON.stringify(m.document())) as { bones: { cubes: { name: string; origin: number[]; size: number[] }[] }[] }).bones[0]!.cubes
    return { used, cubes, root }
  }
  // A sphere of radius 4 at the centre line: symmetric about x = 0, never wider than its diameter, far fewer boxes than cells.
  const ball = made({ shape: "ellipsoid", center: [0, 4, 0], radii: 4 })
  expect(ball.used).toBe(ball.cubes.length)
  expect(ball.used).toBeLessThan(40)
  const xs = ball.cubes.flatMap((cube) => [cube.origin[0]!, cube.origin[0]! + cube.size[0]!])
  expect(Math.min(...xs)).toBe(-4)
  expect(Math.max(...xs)).toBe(4)
  const volume = ball.cubes.reduce((sum, cube) => sum + cube.size[0]! * cube.size[1]! * cube.size[2]!, 0)
  // The filled cells are the ones whose centre is inside: close to 4/3·π·r³ ≈ 268.
  expect(volume).toBeGreaterThan(220)
  expect(volume).toBeLessThan(320)
  const cells = (cubes: { origin: number[]; size: number[] }[]) => cubes.flatMap((cube) => Array.from({ length: cube.size[0]! * cube.size[1]! * cube.size[2]! }, (_, i) => [cube.origin[0]! + (i % cube.size[0]!), cube.origin[1]! + (Math.floor(i / cube.size[0]!) % cube.size[1]!), cube.origin[2]! + Math.floor(i / (cube.size[0]! * cube.size[1]!))].join(",")))
  const own = new Set(cells(ball.cubes))
  expect(cells(ball.cubes).every((cell) => ((p) => own.has([-p[0]! - 1, p[1], p[2]].join(",")))(cell.split(",").map(Number)))).toBe(true)
  // A coarser step: fewer, bigger boxes.
  expect(made({ shape: "ellipsoid", center: [0, 4, 0], radii: 4, step: 2 }).used).toBeLessThan(ball.used)
  // A cone narrows: its top layer is smaller than its base.
  const cone = made({ shape: "cone", from: [0, 0, 0], axis: "y", length: 8, radius: 4, end_radius: 0 })
  const width = (y: number) => cone.cubes.filter((cube) => cube.origin[1]! <= y && cube.origin[1]! + cube.size[1]! > y).reduce((sum, cube) => sum + cube.size[0]! * cube.size[2]!, 0)
  expect(width(7)).toBeLessThan(width(0))
  // A tube along a bent line, and a rounded box: both come out as boxes inside their bounds.
  expect(made({ shape: "tube", points: [[0, 0, 0], [0, 6, 4], [0, 10, 12]], radius: [2, 1] }).used).toBeGreaterThan(1)
  const rounded = made({ shape: "rounded_box", center: [0, 4, 0], size: [8, 8, 8], round: 2 })
  expect(rounded.cubes.every((cube) => cube.origin.every((value, axis) => value >= [-4, 0, -4][axis]! && value + cube.size[axis]! <= [4, 8, 4][axis]!))).toBe(true)
  // What is refused says why and what to do.
  expect(() => made({ shape: "star" })).toThrow("shape 只能是")
  expect(() => made({ shape: "ellipsoid", center: [0, 0, 0], radii: 60 })).toThrow("step 调大")
  expect(() => made({ shape: "ellipsoid", center: [0, 0, 0], radii: 18, step: 1 })).toThrow("还能放")
  // broad3: a round head at the model's own pixel fits on one bone, and no box is left where nothing can ever see it.
  const head = made({ shape: "ellipsoid", center: [0, 9, 0], radii: [9, 8, 8] })
  const filled = new Set(cells(head.cubes))
  const showing = (cube: { origin: number[]; size: number[] }) =>
    cells([cube]).some((cell) => {
      const p = cell.split(",").map(Number)
      return [0, 1, 2].some((axis) => [-1, 1].some((sign) => !filled.has(p.map((value, at) => (at === axis ? value + sign : value)).join(","))))
    })
  expect(head.used).toBeGreaterThan(64)
  expect(head.cubes.every(showing)).toBe(true)
})

test("脚本的 API 里没有任何身体模板、零件包或现成动作；制作说明里有「结构说明」，并且它只是说明", () => {
  const made = surface()
  const offered = [...made.api, ...made.m, ...made.bone, ...made.a, ...made.alone, ...made.c, ...made.random, ...SCRIPT_API.map((entry) => entry[0])]
  expect(offered.filter((name) => /plan|kit|preset|starter|template|blockout|standard|gait|attack|body_?plan/i.test(name))).toEqual([])
  expect(SCRIPT_API.map((entry) => entry[0]).join("\n")).not.toMatch(/starter|plan\.|bodyPlan|preset/)
  // A script is handed `api` and nothing else.
  expect(scriptApi.length).toBe(1)
  expect(made.api).not.toContain("shape")
  expect(Object.keys(scriptApi({wears:null,limits:SCRIPT_LIMITS,particle:true}).api).filter(key=>!made.api.includes(key))).toEqual(["shape"])
  // The knowledge is in words: a titled section of the model-making instructions, with the parts it covers, and no code to copy.
  expect(STRUCTURE_GUIDE).toContain(STRUCTURE_GUIDE_TITLE)
  expect(MODEL_ART_DIRECTION).toContain(STRUCTURE_GUIDE)
  expect(MODEL_ART_DIRECTION).toContain("结构说明")
  for (const part of ["膜翼", "羽翼", "指骨", "覆羽", "飞羽", "脚踝", "四足慢走", "下颌", "一节接一节逐渐变细"]) expect(STRUCTURE_GUIDE).toContain(part)
  expect(STRUCTURE_GUIDE).toContain("以它们为准")
  expect(STRUCTURE_GUIDE).not.toMatch(/api\.|m\.bone|bone\(|=>|\{|\}|starter|plan\.|preset/)
  // The script medium's own words stay free of it.
  expect(SCRIPT_GUIDE).not.toContain(STRUCTURE_GUIDE_TITLE)
})

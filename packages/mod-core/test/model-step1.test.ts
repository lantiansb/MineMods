import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import { checkBbmodel, exportBbmodel } from "../src/bbmodel"
import { blockbenchToDesignResult, designToBlockbench } from "../src/blockbench"
import { assembleBuildSource } from "../src/build-source"
import { compileModel, fitModelAtlas } from "../src/model"
import { modelBounds } from "../src/model-bounds"
import { runScript } from "../src/script-run"
import { tierTaskLines } from "../src/creature-tier"
import type { TargetId } from "../src/target/ids"
import { angledWardenDesign, createTargetAngledBossSample } from "../script/target-angled-boss-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * 第 1 步 (modelling and painting to the epic measure), what the build does with it: a turned, grown, mirrored or shared cube is written into
 * GeckoLib's geometry as GeckoLib reads it and kept through Blockbench both ways; a model script's clock follows its tier; a boss in angled
 * armour, painted rich with a pixel-painted face and a phase that puts on a cracked texture, builds and compiles on all three targets.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const after = ModelDesignSchema.parse(angledWardenDesign(true)) as ModelDesign
const before = ModelDesignSchema.parse(angledWardenDesign(false)) as ModelDesign
type GeoCube = { origin: number[]; size: number[]; inflate?: number; pivot?: number[]; rotation?: number[]; uv: Record<string, { uv: number[]; uv_size: number[] }> }
const cubesOf = (compiled: ReturnType<typeof compileModel>) => (compiled.geometry["minecraft:geometry"][0]!.bones as unknown as { name: string; cubes: GeoCube[] }[])

test("GeckoLib's geometry carries a cube's pivot, rotation and inflate; a mirrored face runs backwards; a shared cube points at its source's texels", () => {
  const compiled = fitModelAtlas(after, "warden")
  const bones = cubesOf(compiled)
  const cube = (bone: string, index: number) => bones.find((value) => value.name === bone)!.cubes[index]!
  expect(cube("shoulder_left", 0)).toMatchObject({ inflate: 0.5, pivot: [9, 36, 0], rotation: [0, 0, -18] })
  expect(cube("shoulder_right", 0)).toMatchObject({ inflate: 0.5, pivot: [-9, 36, 0], rotation: [0, 0, 18] })
  // The right pauldron wears the left one's texels, mirrored: its north face starts at the left one's right edge and runs back; its east face is the left one's west.
  const [left, right] = [cube("shoulder_left", 0).uv, cube("shoulder_right", 0).uv]
  expect(right.north).toEqual({ uv: [left.north!.uv[0]! + left.north!.uv_size[0]!, left.north!.uv[1]!], uv_size: [-left.north!.uv_size[0]!, left.north!.uv_size[1]!] })
  expect(right.east!.uv[0]! + right.east!.uv_size[0]!).toBe(left.west!.uv[0])
  // A cube that says none of it is written as it always was.
  expect(Object.keys(cube("hips", 0))).toEqual(["origin", "size", "uv"])
  expect(Object.keys(cubesOf(fitModelAtlas(before, "warden")).flatMap((bone) => bone.cubes).reduce((all, value) => ({ ...all, ...value }), {})).sort()).toEqual(["origin", "size", "uv"])
  // Sharing and packing: the same creature needs a smaller texture than written upright, each side its own.
  expect(compiled.geometry["minecraft:geometry"][0]!.description.texture_width).toBeLessThanOrEqual(fitModelAtlas(before, "warden").geometry["minecraft:geometry"][0]!.description.texture_width)
})

test("the bounds of a model reach as far as its turned and grown cubes do", () => {
  const plate = (extra: Record<string, unknown>) =>
    ModelDesignSchema.parse({ name: "p", texture_size: 64, bones: [{ name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ name: "plate", origin: [-8, 0, 0], size: [16, 1, 1], faces: { north: "#808080", east: "#808080", south: "#808080", west: "#808080", up: "#808080", down: "#808080" }, surface_details: [], ...extra }] }], animations: ["idle", "walk", "hurt"].map((name) => ({ name, length: 1, loop: true, channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] })) }) as ModelDesign
  expect(modelBounds(plate({})).max[1]).toBeCloseTo(1, 5)
  expect(modelBounds(plate({ rotation: [0, 0, 90], pivot: [0, 0, 0.5] })).max[1]).toBeCloseTo(8, 5)
  expect(modelBounds(plate({ inflate: 1 })).max[1]).toBeCloseTo(2, 5)
  expect(modelBounds(plate({ inflate: 1 })).min[1]).toBeCloseTo(-1, 5)
})

test("Blockbench both ways keeps a cube's turn, growth, mirror and share, and the model's shading and layout; the exported .bbmodel is sound", () => {
  const project = designToBlockbench(after)
  const element = (project.elements ?? []).find((value) => value.name === "pauldron")!
  expect(element).toMatchObject({ origin: [9, 36, 0], rotation: [0, 0, -18], inflate: 0.5 })
  const back = blockbenchToDesignResult(JSON.parse(JSON.stringify(project))).design
  // The rich shading is in the texels read back (every painted face kept pixel for pixel), so it is not painted a second time; without a texture it is.
  expect(back.shading).toBeUndefined()
  expect(blockbenchToDesignResult({ ...JSON.parse(JSON.stringify(project)), textures: [] }).design.shading).toBe("rich")
  expect(back.atlas).toBe("packed")
  expect(back.budget).toBe("epic")
  const cube = (design: ModelDesign, bone: string, name: string) => design.bones.find((value) => value.name === bone)!.cubes.find((value) => value.name === name)!
  expect(cube(back, "shoulder_right", "pauldron")).toMatchObject({ rotation: [0, 0, 18], pivot: [-9, 36, 0], inflate: 0.5, share: "shoulder_left.pauldron", mirror: true })
  expect(cube(back, "head", "tusk_left")).toMatchObject({ rotation: [-30, -15, 0], pivot: [3, 38, -7] })
  // The face painted pixel by pixel comes back pixel by pixel, and the texture it all compiles to is the same.
  expect(cube(back, "head", "skull").pixels?.north?.data.length).toBe(90)
  expect(Buffer.from(compileModel(back, "w").png).equals(Buffer.from(compileModel(after, "w").png))).toBe(true)
  const compiled = compileModel(after, "warden")
  const bbmodel = exportBbmodel({ name: after.name, geometry: compiled.geometry, animation: compiled.animation, png: compiled.png })
  expect(checkBbmodel(JSON.parse(JSON.stringify(bbmodel)))).toEqual([])
  const written = (bbmodel as unknown as { elements: { rotation: number[]; inflate?: number }[] }).elements
  expect(written.filter((value) => value.rotation.some((angle) => angle !== 0)).length).toBeGreaterThan(10)
  expect(written.some((value) => value.inflate === 0.5)).toBe(true)
})

test("a hand-made .bbmodel that names no tier is held to the lowest tier it fits, not refused for being past the standard one", () => {
  const project = designToBlockbench(after) as unknown as { minemods?: Record<string, unknown>; elements: Record<string, unknown>[]; outliner: { children: unknown[] }[] }
  delete project.minemods
  // 300 boxes: past the standard tier's 256.
  const extra = Array.from({ length: 300 - project.elements.length }, (_, index) => ({ uuid: `extra-${index}`, name: `rivet_${index}`, type: "cube", from: [index % 20, 50 + Math.floor(index / 20), 0], to: [index % 20 + 1, 51 + Math.floor(index / 20), 1], faces: Object.fromEntries(["north", "east", "south", "west", "up", "down"].map((face) => [face, { uv: [0, 0, 1, 1], texture: null, color: 0x808080 }])) }))
  project.elements.push(...extra)
  project.outliner[0]!.children.push(...extra.map((value) => value.uuid))
  const result = blockbenchToDesignResult(JSON.parse(JSON.stringify(project)))
  expect(result.design.budget).toBe("fine")
  expect(result.design.bones.reduce((sum, bone) => sum + bone.cubes.length, 0)).toBe(300)
})

test("a model script's clock follows the tier its api.model names; an epic script turns, shares and paints faces pixel by pixel", async () => {
  const slow = (budget: string) => `const m = api.model({ name: "slow", budget: "${budget}" }); const until = 2600; let x = 0; for (let i = 0; i < 4e9; i++) { x += i; if (i % 1e6 === 0 && api.note && false) break } return m`
  // Standard: two seconds, stopped. The epic tier's six are not reached by a script that finishes.
  const standard = await runScript("model", slow("standard"))
  expect(standard).toMatchObject({ ok: false, error: expect.stringContaining("时间上限") })
  const script = `
    const m = api.model({ name: "warden", budget: "epic", texture_size: 128, shading: "rich", atlas: "packed" })
    const root = m.bone("root")
    const arm = m.bone("arm_left", { parent: "root", pivot: [6, 10, 0] })
    arm.cube("plate", { origin: [5, 6, -2], size: [4, 6, 4], paint: { material: "metal", base: "#8e959c", wear: 0.6 }, rotation: [0, 0, -20], pivot: [6, 10, 0], inflate: 0.5 })
    const c = api.canvas(6, 6, "#404040")
    for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) c.set(x, y, api.mix("#203040", "#c0d0e0", (x * 6 + y) / 36))
    root.cube("skull", { origin: [-3, 10, -3], size: [6, 6, 6], paint: { material: "stone", base: "#7a7468" }, draw: { north: c } })
    m.mirror("arm_left", { from: "_left", to: "_right", share: true })
    for (const name of ["idle", "walk", "hurt"]) m.animation(name, { length: 1, loop: name !== "hurt" }).key("root", 0, [0, 0, 0])
    return m`
  const ran = await runScript("model", script)
  expect(ran.ok).toBe(true)
  if (!ran.ok) return
  const { kind: _kind, ...design } = ran.document as unknown as ModelDesign & { kind: string }
  expect(design.bones.find((bone) => bone.name === "arm_right")!.cubes[0]).toMatchObject({ share: "arm_left.plate", mirror: true, rotation: [0, 0, 20] })
  // 36 colours on one face: more than 64 rectangles would have taken, kept as the face's pixels.
  expect(design.bones[0]!.cubes[0]!.pixels?.north?.palette.length).toBe(36)
  expect(compileModel(design, "scripted").png.length).toBeGreaterThan(0)
}, 30000)

test("the maker of a boss's or an epic creature's model is told the epic magnitudes", () => {
  const entries = [{ key: "boss", kind: "entity", title: "首领", owner: null, tier: { level: "epic", by: "you", reason: "" } }, { key: "boss-model", kind: "model", title: "首领模型", owner: "boss" }] as never
  const lines = tierTaskLines(entries, "boss-model").join("\n")
  expect(lines).toContain("60–120")
})

async function wardenBuild(target: TargetId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-angled-warden-"))
  roots.push(root)
  const project = await createTargetAngledBossSample(path.join(root, "斜甲守卫"), target)
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(path.join(root, "斜甲守卫"), source, TEMPLATE)
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
  return { project, source, built, names, read: (name: string) => readFile(path.join(source, name)) }
}

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: a boss of angled, grown, mirrored plates, painted rich with a pixel-painted face, that puts on a cracked texture at half its life, builds and compiles`, async () => {
    const build = await wardenBuild(target)
    const id = `creature_${build.project.entities[0]!.id.replaceAll("-", "")}`
    const geo = build.names.find((name) => name.endsWith(`geo/${id}.geo.json`) || (name.includes("/geo/") && name.endsWith(".geo.json")))!
    expect(geo).toBeDefined()
    const geometry = JSON.parse(String(await build.read(geo)))["minecraft:geometry"][0] as { bones: { cubes: GeoCube[] }[] }
    const cubes = geometry.bones.flatMap((bone) => bone.cubes)
    expect(cubes.filter((cube) => cube.rotation).length).toBeGreaterThan(10)
    expect(cubes.some((cube) => cube.inflate === 0.5)).toBe(true)
    expect(cubes.some((cube) => Object.values(cube.uv).some((face) => face.uv_size[0]! < 0))).toBe(true)
    expect(build.names.some((name) => name.endsWith(`${id}_phase_1.png`))).toBe(true)
    const renderer = String(await build.read(build.names.find((name) => /client\/StudioCreatureRenderer\w*\.java$/.test(name))!))
    expect(renderer).toContain("return BOSS_TEXTURES[creature.bossTexture()];")
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(build.source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

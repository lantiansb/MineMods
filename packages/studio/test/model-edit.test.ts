import { expect, test } from "bun:test"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { expandBonePatch } from "../src/main/model-bone-patch"
import { WorkspaceAssetSchema } from "@minemods/mod-core/workspace"
import { mushroomCowDesign } from "@minemods/mod-core/example"
import {
  boneFamily,
  boneOf,
  createHistory,
  deleteBone,
  deleteKeyframe,
  faceRectCenter,
  faceSize,
  fillFace,
  keyframeTimes,
  mirrorBone,
  modelPalette,
  moveBone,
  paintTexels,
  rotateBone,
  scaleBone,
  setAnimationTiming,
  setKeyframe,
  texelAt,
  texelColor,
  tintBone,
  type FaceName,
} from "../src/renderer/model-edit"
import * as THREE from "three"
import { gameFaceUV } from "../src/renderer/model-core/blockbench-uv"

const design = mushroomCowDesign
const leaf = design.bones.find((bone) => bone.parent !== null && !design.bones.some((child) => child.parent === bone.name))!
const root = design.bones.find((bone) => bone.parent === null)!

test("局部修改只替换指定骨骼，并核对模型版本", async () => {
  const timestamp = new Date().toISOString()
  const asset = WorkspaceAssetSchema.parse({ id: crypto.randomUUID(), title: "蘑菇牛", module: "model", revision: 2,
    prompt: "模型", created_at: timestamp, updated_at: timestamp, dependencies: [], provenance: { model: null, request_id: null }, status: "ready", document: { kind: "model", ...design } })
  const patch = { kind: "model_bone_patch", revision: 2, bones: [{ name: leaf.name, pivot: [1, 2, 3] }] }
  expect(await expandBonePatch(patch, async () => asset)).toEqual({ ...asset.document, bones: design.bones.map((bone) => bone === leaf ? { ...bone, pivot: [1, 2, 3] } : bone) })
  await expect(expandBonePatch({ ...patch, revision: 1 }, async () => asset)).rejects.toThrow("版本")
  await expect(expandBonePatch({ ...patch, bones: [{ name: "missing", rotation: [0, 0, 0] }] }, async () => asset)).rejects.toThrow("找不到")
  await expect(expandBonePatch(patch, async () => undefined)).rejects.toThrow("现有模型")
})

test("selection resolves to the owning bone", () => {
  const cube = root.cubes[0]!
  expect(boneOf(design, `${root.name}.${cube.name}`)).toBe(root.name)
  expect(boneOf(design, root.name)).toBe(root.name)
  expect(boneOf(design, "")).toBeUndefined()
  expect(boneFamily(design, root.name).size).toBe(design.bones.length)
})

test("tint keeps the face shading and stays valid", () => {
  const result = tintBone(design, root.name, "#3366cc")
  if (!result.ok) throw new Error(result.message)
  const before = root.cubes[0]!.faces
  const after = result.design.bones.find((bone) => bone.name === root.name)!.cubes[0]!.faces
  expect(after.north).not.toBe(before.north)
  if (before.up !== before.north) expect(after.up).not.toBe(after.north)
  expect(ModelDesignSchema.safeParse(result.design).success).toBe(true)
  expect(design.bones.find((bone) => bone.name === root.name)!.cubes[0]!.faces.north).toBe(before.north)
  expect(tintBone(design, root.name, "blue").ok).toBe(false)
})

test("moving a part carries its children", () => {
  const result = moveBone(design, root.name, 1, 2)
  if (!result.ok) throw new Error(result.message)
  result.design.bones.forEach((bone, index) => {
    expect(bone.pivot[1]).toBe(design.bones[index]!.pivot[1] + 2)
  })
  expect(moveBone(design, root.name, 0, 400).ok).toBe(false)
})

test("rotation wraps into -180..180", () => {
  const result = rotateBone(design, leaf.name, 1, 200 - leaf.rotation[1])
  if (!result.ok) throw new Error(result.message)
  expect(result.design.bones.find((bone) => bone.name === leaf.name)!.rotation[1]).toBe(-160)
})

test("scaling keeps whole-block sizes and stops at the minimum", () => {
  const bigger = scaleBone(design, root.name, 1.25)
  if (!bigger.ok) throw new Error(bigger.message)
  bigger.design.bones
    .find((bone) => bone.name === root.name)!
    .cubes.forEach((cube) => cube.size.forEach((value) => expect(Number.isInteger(value)).toBe(true)))
  const tiny = design.bones.find((bone) => bone.cubes.every((cube) => cube.size.every((value) => value === 1)))
  if (tiny) expect(scaleBone(design, tiny.name, 0.8).ok).toBe(false)
})

test("deleting protects the root and drops motions of removed parts", () => {
  expect(deleteBone(design, root.name).ok).toBe(false)
  const result = deleteBone(design, leaf.name)
  if (result.ok) {
    expect(result.design.bones.some((bone) => bone.name === leaf.name)).toBe(false)
    expect(result.design.animations.flatMap((a) => a.channels).some((channel) => channel.bone === leaf.name)).toBe(false)
  } else {
    expect(result.message.length).toBeGreaterThan(0)
  }
})

test("mirroring adds a valid opposite copy with its own motion", () => {
  const result = mirrorBone(design, leaf.name)
  if (!result.ok) throw new Error(result.message)
  const copy = result.design.bones.at(-1)!
  expect(copy.name).not.toBe(leaf.name)
  expect(copy.pivot[0]).toBe(-leaf.pivot[0])
  expect(copy.cubes[0]!.origin[0]).toBe(-(leaf.cubes[0]!.origin[0] + leaf.cubes[0]!.size[0]))
  expect(result.design.bones.length).toBe(design.bones.length + 1)
})

test("history undoes and redoes", () => {
  const history = createHistory(design)
  const moved = moveBone(design, root.name, 0, 1)
  if (!moved.ok) throw new Error(moved.message)
  history.push(moved.design)
  expect(history.canUndo).toBe(true)
  expect(history.undo()).toBe(design)
  expect(history.canRedo).toBe(true)
  expect(history.redo()).toBe(moved.design)
})

test("palette lists the model's colours", () => {
  const palette = modelPalette(design)
  expect(palette.length).toBeGreaterThan(0)
  palette.forEach((color) => expect(color).toMatch(/^#[0-9a-f]{6}$/))
})

const faces: FaceName[] = ["north", "east", "south", "west", "up", "down"]
const cubePart = `${root.name}.${root.cubes[0]!.name}`
const rootIndex = design.bones.indexOf(root)

test("texel lookup round-trips on every face", () => {
  const size: [number, number, number] = [5, 7, 3]
  faces.forEach((face) => {
    const [width, height] = faceSize(size, face)
    for (let x = 0; x < width; x++)
      for (let y = 0; y < height; y++) {
        const hit = texelAt(size, faceRectCenter(size, face, { x, y, width: 1, height: 1 }, 0.01))
        expect(hit).toEqual({ face, x, y })
      }
  })
})

test("painted texels land where the compiled texture puts them", () => {
  // Same order and UV mapping the viewport uses for textured models.
  const size: [number, number, number] = [4, 6, 8]
  const order: FaceName[] = ["east", "west", "up", "down", "south", "north"]
  const box = new THREE.BoxGeometry(...size)
  const position = box.getAttribute("position")
  order.forEach((face, index) => {
    const [width, height] = faceSize(size, face)
    const corners = gameFaceUV(face, [0, 0, width, height], [width, height])
    const vertex = (k: number) => new THREE.Vector3().fromBufferAttribute(position, index * 4 + k)
    // Texel (0,0) is the corner of the texture rectangle that maps to UV corner 0.
    const corner = (u:number,v:number) => vertex(corners.findIndex(([x,y]) => x === u && y === v))
    const origin = corner(0,1)
    const along = corner(1,1).sub(origin).normalize()
    const down = corner(0,0).sub(origin).normalize()
    const expected = origin.clone().addScaledVector(along, 0.5).addScaledVector(down, 0.5)
    const actual = faceRectCenter(size, face, { x: 0, y: 0, width: 1, height: 1 })
    expect(actual.map((value) => Math.round(value * 1000) / 1000)).toEqual(
      expected.toArray().map((value) => Math.round(value * 1000) / 1000),
    )
  })
})

test("painting merges texels into few rectangles and erasing restores the face", () => {
  const cube = root.cubes[0]!
  const [width] = faceSize(cube.size, "south")
  const row = Array.from({ length: width }, (_, x) => ({ x, y: 0 }))
  const painted = paintTexels(design, [{ part: cubePart, face: "south", texels: row }], "#112233")
  if (!painted.ok) throw new Error(painted.message)
  const south = painted.design.bones[rootIndex]!.cubes[0]!.surface_details.filter((detail) => detail.face === "south")
  expect(south).toContainEqual({ face: "south", x: 0, y: 0, width, height: 1, color: "#112233" })
  expect(south.filter((detail) => detail.y === 0)).toHaveLength(1)
  expect(texelColor(painted.design, cubePart, "south", { x: 1, y: 0 })).toBe("#112233")
  const erased = paintTexels(painted.design, [{ part: cubePart, face: "south", texels: row }], null)
  if (!erased.ok) throw new Error(erased.message)
  expect(
    erased.design.bones[rootIndex]!.cubes[0]!.surface_details.some((detail) => detail.face === "south" && detail.y === 0),
  ).toBe(false)
  expect(paintTexels(erased.design, [{ part: cubePart, face: "south", texels: row }], null).ok).toBe(false)
})

test("a checkerboard that needs too many pieces is refused", () => {
  const big = structuredClone(design)
  big.bones[rootIndex]!.cubes[0]!.size = [16, 16, 16]
  big.bones[rootIndex]!.cubes[0]!.surface_details = []
  const texels = Array.from({ length: 16 * 16 }, (_, index) => ({ x: index % 16, y: Math.floor(index / 16) })).filter(
    ({ x, y }) => (x + y) % 2 === 0,
  )
  const result = paintTexels(big, [{ part: cubePart, face: "north", texels }], "#ffffff")
  expect(result.ok).toBe(false)
})

test("filling a face replaces its colour and clears its details", () => {
  const painted = paintTexels(design, [{ part: cubePart, face: "up", texels: [{ x: 0, y: 0 }] }], "#ff0000")
  if (!painted.ok) throw new Error(painted.message)
  const filled = fillFace(painted.design, cubePart, "up", "#00AA00")
  if (!filled.ok) throw new Error(filled.message)
  const cube = filled.design.bones[rootIndex]!.cubes[0]!
  expect(cube.faces.up).toBe("#00aa00")
  expect(cube.surface_details.some((detail) => detail.face === "up")).toBe(false)
})

test("keyframes are added in order, replaced in place and removed", () => {
  const walk = design.animations.find((animation) => animation.name === "walk")!
  const bone = leaf.name
  const added = setKeyframe(design, "walk", bone, walk.length / 2, [15, 0, 0])
  if (!added.ok) throw new Error(added.message)
  const times = keyframeTimes(added.design, "walk", bone)
  expect(times).toContain(Math.round((walk.length / 2) * 100) / 100)
  expect([...times].sort((a, b) => a - b)).toEqual(times)
  const replaced = setKeyframe(added.design, "walk", bone, walk.length / 2, [30, 0, 0])
  if (!replaced.ok) throw new Error(replaced.message)
  expect(keyframeTimes(replaced.design, "walk", bone)).toEqual(times)
  const channel = replaced.design.animations.find((a) => a.name === "walk")!.channels.find((c) => c.bone === bone)!
  expect(channel.keyframes.find((frame) => Math.abs(frame.time - walk.length / 2) < 0.01)!.rotation[0]).toBe(30)
  const removed = deleteKeyframe(replaced.design, "walk", bone, walk.length / 2)
  if (!removed.ok) throw new Error(removed.message)
  expect(keyframeTimes(removed.design, "walk", bone)).not.toContain(Math.round((walk.length / 2) * 100) / 100)
  expect(deleteKeyframe(removed.design, "walk", bone, walk.length / 2).ok).toBe(false)
})

test("shortening a motion drops keyframes past the new end", () => {
  const walk = design.animations.find((animation) => animation.name === "walk")!
  const result = setAnimationTiming(design, "walk", { length: walk.length / 2, loop: false })
  if (!result.ok) throw new Error(result.message)
  const next = result.design.animations.find((animation) => animation.name === "walk")!
  expect(next.loop).toBe(false)
  next.channels.forEach((channel) => channel.keyframes.forEach((frame) => expect(frame.time).toBeLessThanOrEqual(next.length)))
  expect(setAnimationTiming(design, "walk", { length: 0 }).ok).toBe(false)
  expect(setAnimationTiming(design, "walk", { length: 31 }).ok).toBe(false)
})

// 11-09: on a model drawn from a material the face colours are never shown, so 整面填充 and 换色 changed data nobody could see.
test("on a painted cube, fill and recolour change what is shown, and the brush keeps a colour equal to the face's", async () => {
  const painted = ModelDesignSchema.parse(JSON.parse(await Bun.file(new URL("./fixtures/model-quality/forest-creeper.painted.design.json", import.meta.url)).text()))
  const { cubePaint } = await import("@minemods/studio-ai/model-paint")
  const bone = painted.bones.find((value) => value.cubes.some((cube) => cubePaint(painted, value, cube)))!
  const cube = bone.cubes.find((value) => cubePaint(painted, bone, value))!
  const part = `${bone.name}.${cube.name}`
  const [width, height] = faceSize(cube.size, "north", painted.texel_size ?? 1)

  const filled = fillFace(painted, part, "north", "#ff00ff")
  expect(filled.ok).toBe(true)
  const after = filled.ok ? filled.design.bones.find((value) => value.name === bone.name)!.cubes.find((value) => value.name === cube.name)! : null
  expect(after!.surface_details.filter((detail) => detail.face === "north")).toEqual([{ face: "north", x: 0, y: 0, width, height, color: "#ff00ff" }])
  expect(texelColor(filled.ok ? filled.design : painted, part, "north", { x: 0, y: 0 })).toBe("#ff00ff")

  const tinted = tintBone(painted, bone.name, "#3366cc")
  expect(tinted.ok).toBe(true)
  const was = cubePaint(painted, bone, cube)!.base
  const now = tinted.ok ? cubePaint(tinted.design, tinted.design.bones.find((value) => value.name === bone.name)!, tinted.design.bones.find((value) => value.name === bone.name)!.cubes.find((value) => value.name === cube.name)!)!.base : was
  expect(now).not.toBe(was)

  const same = paintTexels(painted, [{ part, face: "north", texels: [{ x: 0, y: 0 }] }], cube.faces.north)
  expect(same.ok, "a colour equal to the unseen face colour is still painted").toBe(true)
})

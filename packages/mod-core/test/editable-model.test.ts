import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { blockbenchToDesignResult, designToBlockbench } from "../src/blockbench"
import { compileSavedModel } from "../src/editable-model"
import { sampleTrack } from "@minemods/studio-ai/animation"
import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"

const design: ModelDesign = ModelDesignSchema.parse({
  name: "Copper Owl",
  texture_size: 64,
  bones: [
    { name: "root", parent: null, pivot: [0, 8, 0], rotation: [0, 0, 0], cubes: [{ name: "body", origin: [-4, 4, -3], size: [8, 8, 6], faces: { north: "#8a4f2b", east: "#8a4f2b", south: "#8a4f2b", west: "#8a4f2b", up: "#b16b37", down: "#63341e" } }] },
    { name: "wing", parent: "root", pivot: [4, 10, 0], rotation: [0, 12, 0], cubes: [{ name: "feather", origin: [4, 7, -1], size: [2, 5, 2], faces: { north: "#bd7a42", east: "#bd7a42", south: "#bd7a42", west: "#bd7a42", up: "#d49559", down: "#81451f" } }] },
  ],
  animations: ["idle", "walk", "hurt"].map((name) => ({
    name,
    length: 1,
    loop: name !== "hurt",
    channels: [
      { bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [0, 3, 0] }] },
      { bone: "wing", keyframes: [{ time: 0, rotation: [0, 12, 0] }, { time: 1, rotation: [0, 18, 0] }] },
    ],
  })),
})

const hierarchyFaces = {
  north: "#5f4634",
  east: "#5f4634",
  south: "#5f4634",
  west: "#5f4634",
  up: "#8a6947",
  down: "#34271f",
}

const nonDfsDesign = (bones: ModelDesign["bones"]): ModelDesign => ModelDesignSchema.parse({
  name: "Non DFS Creature",
  texture_size: 64,
  bones,
  animations: ["idle", "walk", "hurt"].map((name) => ({
    name,
    length: 1,
    loop: name !== "hurt",
    channels: bones.map((bone, index) => ({
      bone: bone.name,
      keyframes: [{ time: 0, rotation: [index, index + 1, index + 2] as [number, number, number] }, { time: 1, rotation: [index + 3, index + 4, index + 5] as [number, number, number] }],
    })),
  })),
})

function snapshot() {
  const project = structuredClone(designToBlockbench(design))
  project.elements![0]!.faces.north!.uv = [3, 4, 11, 12]
  project.elements![0]!.rotation = [0, 22, 0]
  project.elements![0]!.origin = [1, 2, 3]
  return project
}

function embeddedPng(project: ReturnType<typeof designToBlockbench>) {
  return Buffer.from((project.textures![0] as { source: string }).source.split(",")[1]!, "base64")
}

describe("saved Blockbench model compilation", () => {
  test("matches non-DFS bones by identity so deep children keep elements, UVs, and animation bindings", () => {
    const source = nonDfsDesign([
      { name: "root", parent: null, pivot: [0, 8, 0], rotation: [0, 0, 0], cubes: [{ name: "root_cube", origin: [-4, 4, -3], size: [8, 8, 6], faces: hierarchyFaces, surface_details: [] }] },
      { name: "left", parent: "root", pivot: [-4, 8, 0], rotation: [0, 0, 0], cubes: [{ name: "left_cube", origin: [-6, 4, -1], size: [2, 5, 2], faces: hierarchyFaces, surface_details: [] }] },
      { name: "right", parent: "root", pivot: [4, 8, 0], rotation: [0, 0, 0], cubes: [{ name: "right_cube", origin: [4, 4, -1], size: [2, 5, 2], faces: hierarchyFaces, surface_details: [] }] },
      { name: "left_child", parent: "left", pivot: [-4, 6, 0], rotation: [0, 0, 0], cubes: [{ name: "deep_cube", origin: [-5, 3, -1], size: [1, 3, 1], faces: hierarchyFaces, surface_details: [] }] },
    ])
    const project = designToBlockbench(source)
    project.elements![3]!.faces.north!.uv = [9, 10, 10, 13]
    const result = compileSavedModel({ design: source, blockbench: project }, "non_dfs")
    const geometryBones = result.geometry["minecraft:geometry"][0].bones
    expect(geometryBones.map((bone) => bone.name)).toEqual(["root", "left", "right", "left_child"])
    expect(geometryBones.find((bone) => bone.name === "left_child")!.cubes[0]).toMatchObject({ name: "deep_cube" })
    expect(geometryBones.find((bone) => bone.name === "left_child")!.cubes[0]!.uv.north).toEqual({ uv: [9, 10], uv_size: [1, 3] })
    expect(result.animation.animations["animation.non_dfs.walk"].bones.left_child.rotation["1.0"]).toEqual([6, 7, 8])
  })

  test("accepts a valid hierarchy when the root appears after its descendants in design order", () => {
    const source = nonDfsDesign([
      { name: "left", parent: "root", pivot: [-4, 8, 0], rotation: [0, 0, 0], cubes: [{ name: "left_cube", origin: [-6, 4, -1], size: [2, 5, 2], faces: hierarchyFaces, surface_details: [] }] },
      { name: "right", parent: "root", pivot: [4, 8, 0], rotation: [0, 0, 0], cubes: [{ name: "right_cube", origin: [4, 4, -1], size: [2, 5, 2], faces: hierarchyFaces, surface_details: [] }] },
      { name: "left_child", parent: "left", pivot: [-4, 6, 0], rotation: [0, 0, 0], cubes: [{ name: "deep_cube", origin: [-5, 3, -1], size: [1, 3, 1], faces: hierarchyFaces, surface_details: [] }] },
      { name: "root", parent: null, pivot: [0, 8, 0], rotation: [0, 0, 0], cubes: [{ name: "root_cube", origin: [-4, 4, -3], size: [8, 8, 6], faces: hierarchyFaces, surface_details: [] }] },
    ])
    expect(() => compileSavedModel({ design: source, blockbench: designToBlockbench(source) }, "root_after")).not.toThrow()
  })

  test("rejects an unknown bone identity and a changed parent relationship", () => {
    const source = nonDfsDesign([
      { name: "root", parent: null, pivot: [0, 8, 0], rotation: [0, 0, 0], cubes: [{ name: "root_cube", origin: [-4, 4, -3], size: [8, 8, 6], faces: hierarchyFaces, surface_details: [] }] },
      { name: "left", parent: "root", pivot: [-4, 8, 0], rotation: [0, 0, 0], cubes: [{ name: "left_cube", origin: [-6, 4, -1], size: [2, 5, 2], faces: hierarchyFaces, surface_details: [] }] },
      { name: "right", parent: "root", pivot: [4, 8, 0], rotation: [0, 0, 0], cubes: [{ name: "right_cube", origin: [4, 4, -1], size: [2, 5, 2], faces: hierarchyFaces, surface_details: [] }] },
      { name: "left_child", parent: "left", pivot: [-4, 6, 0], rotation: [0, 0, 0], cubes: [{ name: "deep_cube", origin: [-5, 3, -1], size: [1, 3, 1], faces: hierarchyFaces, surface_details: [] }] },
    ])
    const identityMismatch = designToBlockbench(source)
    ;(identityMismatch.outliner![0] as { name: string }).name = "renamed_root"
    expect(() => compileSavedModel({ design: source, blockbench: identityMismatch }, "identity_mismatch")).toThrow("MODEL_HIERARCHY_DESIGN_MISMATCH")

    const hierarchyMismatch = designToBlockbench(source)
    type EditableNode = { name: string; children: Array<string | EditableNode> }
    const root = hierarchyMismatch.outliner![0] as EditableNode
    const left = root.children.find((child): child is EditableNode => typeof child !== "string" && child.name === "left")!
    const right = root.children.find((child): child is EditableNode => typeof child !== "string" && child.name === "right")!
    const deep = left.children.find((child): child is EditableNode => typeof child !== "string" && child.name === "left_child")!
    left.children = left.children.filter((child) => child !== deep)
    right.children.push(deep)
    expect(() => compileSavedModel({ design: source, blockbench: hierarchyMismatch }, "hierarchy_mismatch")).toThrow("MODEL_HIERARCHY_DESIGN_MISMATCH")
  })

  test("matches the normalized names used by imported Blockbench groups", () => {
    const project = designToBlockbench(design)
    const root = project.outliner![0] as { name: string; children: Array<string | { name: string }> }
    root.name = "森林 根"
    ;(root.children.find((child): child is { name: string } => typeof child !== "string")!).name = "左枝"
    const imported = blockbenchToDesignResult(project)
    expect(imported.design.bones.map((bone) => bone.name)).toEqual(["part", "part_1"])
    expect(() => compileSavedModel({ design: imported.design, blockbench: project }, "normalized_names")).not.toThrow()
  })

  test("roundtrips duplicate long group names without truncation collisions", () => {
    const longRoot = "a".repeat(48)
    const longChild = `${"a".repeat(46)}_1`
    const longDesign = ModelDesignSchema.parse({
      ...design,
      bones: design.bones.map((bone, index) => ({
        ...bone,
        name: index === 0 ? longRoot : longChild,
        parent: index === 0 ? null : longRoot,
      })),
      animations: design.animations.map((animation) => ({
        ...animation,
        channels: animation.channels.map((channel) => ({
          ...channel,
          bone: channel.bone === "root" ? longRoot : longChild,
        })),
      })),
    })
    const project = designToBlockbench(longDesign)
    const root = project.outliner![0] as { name: string; children: Array<string | { name: string; children: Array<string | unknown> }> }
    const child = root.children.find((value): value is { name: string; children: Array<string | unknown> } => typeof value !== "string")!
    root.name = "a".repeat(60)
    child.name = "a".repeat(60)

    expect(() => compileSavedModel({ design: longDesign, blockbench: project }, "long_names")).not.toThrow()
    const imported = blockbenchToDesignResult(project)
    expect(imported.design.bones.map((bone) => bone.name)).toEqual([longRoot, longChild])
    expect(() => compileSavedModel({ design: imported.design, blockbench: project }, "long_names_imported")).not.toThrow()
  })

  test("keeps the embedded atlas, UV rectangles, cube transforms, hierarchy, and numeric animations", () => {
    const project = snapshot()
    const png = embeddedPng(project)
    const result = compileSavedModel({ design, blockbench: project }, "creature")
    const cube = result.geometry["minecraft:geometry"][0].bones[0].cubes[0]
    expect(Buffer.from(result.png)).toEqual(png)
    expect(createHash("sha256").update(result.png).digest("hex")).toBe(createHash("sha256").update(png).digest("hex"))
    expect(cube.uv.north).toEqual({ uv: [3, 4], uv_size: [8, 8] })
    expect((cube as typeof cube & { rotation: number[] }).rotation).toEqual([0, 22, 0])
    expect((cube as typeof cube & { pivot: number[] }).pivot).toEqual([1, 2, 3])
    expect(result.geometry["minecraft:geometry"][0].bones.map((bone) => bone.name)).toEqual(["root", "wing"])
    expect(result.geometry["minecraft:geometry"][0].bones[1].parent).toBe("root")
    expect(result.animation.animations["animation.creature.walk"].bones.wing.rotation["1.0"]).toEqual([0, 18, 0])
  })

  test("keeps legacy ModelDesign compilation unchanged", () => {
    const result = compileSavedModel(design, "creature")
    expect(result.design).toEqual(design)
    expect(result.geometry["minecraft:geometry"][0].bones[0].cubes[0].uv.north.uv).toEqual([1, 1])
  })

  test("rejects missing, external, or multiple texture atlases", () => {
    const project = snapshot()
    expect(() => compileSavedModel({ design, blockbench: { ...project, textures: [] } }, "creature")).toThrow("MODEL_TEXTURE_REQUIRED")
    expect(() => compileSavedModel({ design, blockbench: { ...project, textures: [{ path: "owl.png" }] } }, "creature")).toThrow("MODEL_EXTERNAL_TEXTURE")
    expect(() => compileSavedModel({ design, blockbench: { ...project, textures: [...project.textures!, project.textures![0]] } }, "creature")).toThrow("MODEL_TEXTURE_COUNT")
  })

  test("rejects mesh elements and expression keyframes before compiling", () => {
    const project = snapshot()
    expect(() => compileSavedModel({ design, blockbench: { ...project, elements: [{ ...project.elements![0], type: "mesh" }] } }, "creature")).toThrow("MODEL_MESH_UNSUPPORTED")
    const animated = structuredClone(project)
    const animation = animated.animations![0]!
    const animator = animation.animators![Object.keys(animation.animators!)[0]!]!
    animator.keyframes[0]!.data_points![0]!.x = "query.anim_time"
    expect(() => compileSavedModel({ design, blockbench: animated }, "creature")).toThrow("MODEL_EXPRESSION_UNSUPPORTED")
  })

  test("exports custom animations with numeric position and scale tracks", () => {
    const project = snapshot()
    const root = (project.outliner![0] as { uuid: string }).uuid
    project.animations!.push({
      name: "fly",
      length: 12,
      loop: true,
      animators: {
        [root]: {
          keyframes: [
            { time: 0, channel: "position", data_points: [{ x: 0, y: 1, z: 2 }] },
            { time: 6, channel: "position", data_points: [{ x: 3, y: 4, z: 5 }] },
            { time: 0, channel: "scale", data_points: [{ x: 1, y: 1, z: 1 }] },
          ],
        },
      },
    })
    const result = compileSavedModel({ design, blockbench: project }, "creature")
    const fly = result.animation.animations["animation.creature.fly"] as { bones: Record<string, Record<string, Record<string, unknown>>> }
    expect(fly.bones.root.position["6.0"]).toEqual([3, 4, 5])
    expect(fly.bones.root.scale["0.0"]).toEqual([1, 1, 1])
  })

  test("keeps linear and step interpolation, takes bezier with its handles and GeckoLib's easing (第 2 步), and rejects a word it does not know", () => {
    const project = snapshot()
    const root = (project.outliner![0] as { uuid: string }).uuid
    const animator = project.animations![0]!.animators![root]!
    const keyframe = animator.keyframes.find((value) => value.time === 0)!
    const nextKeyframe = animator.keyframes.find((value) => value.time === 1)!
    keyframe.interpolation = "step"
    nextKeyframe.interpolation = "linear"
    animator.keyframes = [nextKeyframe, keyframe]
    const result = compileSavedModel({ design, blockbench: project }, "creature")
    const track = result.animation.animations["animation.creature.idle"].bones.root.rotation as Record<string, unknown>
    expect(track["0.0"]).toEqual([0, 0, 0])
    expect(track["1.0"]).toEqual({ pre: [0, 0, 0], post: [0, 3, 0] })
    // A bezier key: Blockbench's curve, cut into straight pieces the shared sampler agrees with.
    Object.assign(keyframe, { interpolation: "bezier", bezier_right_time: [0.4, 0.4, 0.4], bezier_right_value: [0, 6, 0] })
    const curved = compileSavedModel({ design, blockbench: project }, "creature").animation.animations["animation.creature.idle"].bones.root.rotation as Record<string, number[]>
    expect(Object.keys(curved).length).toBeGreaterThan(2)
    const bezier = [{ time: 0, value: [0, 0, 0] as [number, number, number], interpolation: "bezier" as const, bezier_right_time: [0.4, 0.4, 0.4] as [number, number, number], bezier_right_value: [0, 6, 0] as [number, number, number] }, { time: 1, value: [0, 3, 0] as [number, number, number] }]
    Object.entries(curved).forEach(([time, value]) => expect(Math.abs(value[1]! - sampleTrack(bezier, Number(time))![1]!)).toBeLessThan(0.01))
    // GeckoLib's plugin writes an easing on the key the eased segment arrives at.
    Object.assign(keyframe, { interpolation: "linear" })
    Object.assign(nextKeyframe, { easing: "easeInQuad" })
    const eased = compileSavedModel({ design, blockbench: project }, "creature").animation.animations["animation.creature.idle"].bones.root.rotation as Record<string, number[]>
    expect(Object.keys(eased).length).toBeGreaterThan(2)
    Object.entries(eased).forEach(([time, value]) => expect(value[1]!).toBeCloseTo(3 * Number(time) ** 2, 3))
    keyframe.interpolation = "bouncy"
    expect(() => compileSavedModel({ design, blockbench: project }, "creature")).toThrow("MODEL_INTERPOLATION_UNSUPPORTED")
  })

  test("reports unsupported transparent faces and per-face UV rotation", () => {
    const project = snapshot()
    const north = project.elements![0]!.faces.north as unknown as { texture?: number | null | false; rotation?: number }
    north.texture = false
    expect(() => compileSavedModel({ design, blockbench: project }, "creature")).toThrow("MODEL_FACE_TEXTURE_UNSUPPORTED")
    north.texture = 0
    north.rotation = 90
    expect(() => compileSavedModel({ design, blockbench: project }, "creature")).toThrow("MODEL_FACE_ROTATION_UNSUPPORTED")
  })
})

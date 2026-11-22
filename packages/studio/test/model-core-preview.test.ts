import { describe, expect, test } from "bun:test"
import { blockbenchInterpolate } from "../src/renderer/model-core/blockbench-animation"
import { explodeVector } from "../src/renderer/model-core/geometry"
import { geckoCubePosition, geckoBonePosition, geckoRotation } from "../src/renderer/model-transform"
import { previewBonePosition, previewCubePose, sampleCompiledTrack } from "../src/renderer/model-core/pose"
import { designToBlockbench } from "@minemods/mod-core/blockbench"
import { compileSavedModel } from "@minemods/mod-core/editable-model"
import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"

const fixture: ModelDesign = ModelDesignSchema.parse({
  name: "Imported Boundary",
  texture_size: 64,
  bones: [{ name: "root", parent: null, pivot: [0, 8, 0], rotation: [0, 0, 0], cubes: [{ name: "body", origin: [-2, 4, -2], size: [4, 4, 4], faces: { north: "#aa6644", east: "#aa6644", south: "#aa6644", west: "#aa6644", up: "#ddaa77", down: "#664422" } }] }],
  animations: ["idle", "walk", "hurt"].map((name) => ({ name, length: 1, loop: name !== "hurt", channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [0, 0, 0] }] }] })),
})

function importedFixture() {
  const project = structuredClone(designToBlockbench(fixture))
  const cube = project.elements![0]!
  cube.origin = [2, 9, -1]
  cube.rotation = [0, 22, 0]
  const root = (project.outliner![0] as { uuid: string }).uuid
  project.animations![0]!.animators![root]!.keyframes = [
    { time: 0, channel: "position", data_points: [{ x: 0, y: 0, z: 0 }] },
    { time: 1, channel: "position", data_points: [{ x: 4, y: 0, z: 0 }] },
    { time: 0, channel: "scale", data_points: [{ x: 1, y: 1, z: 1 }], interpolation: "step" },
    { time: 1, channel: "scale", data_points: [{ x: 2, y: 1, z: 1 }] },
  ]
  return { project, result: compileSavedModel({ design: fixture, blockbench: project }, "creature") }
}

describe("imported Blockbench preview boundaries", () => {
  test("keeps an imported cube pivot separate from its parent bone pivot", () => {
    const { result } = importedFixture()
    const cube = result.geometry["minecraft:geometry"][0].bones[0].cubes[0] as typeof result.geometry["minecraft:geometry"][0]["bones"][number]["cubes"][number] & { pivot: [number, number, number]; rotation: [number, number, number] }
    expect(cube.pivot).toEqual([2, 9, -1])
    expect(previewCubePose(cube, fixture.bones[0]!.pivot)).toEqual({ pivot: [-2, 1, -1], position: [2, -3, 1], rotation: geckoRotation([0, 22, 0]) })
    expect(geckoBonePosition(cube.pivot, fixture.bones[0]!.pivot)).toEqual([-2, 1, -1])
    expect(geckoCubePosition(cube.origin as [number, number, number], cube.size as [number, number, number], cube.pivot)).toEqual([2, -3, 1])
    expect(geckoRotation([0, 22.5, 0])[1]).toBeCloseTo(-Math.PI / 8)
  })

  test("preserves imported position, scale and step animation semantics", () => {
    const { result } = importedFixture()
    const fly = result.animation.animations["animation.creature.idle"] as { bones: Record<string, Record<string, Record<string, unknown>>> }
    const position = sampleCompiledTrack(fly.bones.root.position as never, 0.5)
    const scale = sampleCompiledTrack(fly.bones.root.scale as never, 0.5)
    expect(position).toEqual([2, 0, 0])
    expect(scale).toEqual([1, 1, 1])
    expect(sampleCompiledTrack(fly.bones.root.scale as never, 1)).toEqual([2, 1, 1])
    expect(previewBonePosition([4, 8, -2], explodeVector(1, 4, 2), position!)).toEqual([2, 8, 0])
  })
})

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import { BlockbenchImportError, blockbenchToDesign, designToBlockbench } from "../src/blockbench"
import { boneNamesFor } from "../src/bone-names"
import { compileSavedModel } from "../src/editable-model"
import { mushroomCowDesign } from "../src/example"
import { dragonDesign } from "./giant-flier"
import { contractMachine } from "./fixtures/animation-contract/machine"

// Every model Studio ships as an example or keeps as a fixture: the bundled example, the animation contract's machine, the giant
// flier, the pre-0a project's saved model and each look-gate specimen (good ones and the bad ones, one of which is real AI output).
function shippedModels() {
  const found: [string, ModelDesign][] = [
    ["bundled example", mushroomCowDesign],
    ["animation contract machine", contractMachine()],
    ["giant flier", dragonDesign],
    ["pre-0a saved model", ModelDesignSchema.parse(JSON.parse(readFileSync(path.join(import.meta.dir, "fixtures/pre-0a/model-asset.json"), "utf8")).data.design)],
  ]
  const look = path.join(import.meta.dir, "../../studio-ai/test/fixtures/look")
  for (const folder of ["good", "bad"])
    for (const file of readdirSync(path.join(look, folder)).filter((name) => name.endsWith(".json")).sort()) {
      const specimen = JSON.parse(readFileSync(path.join(look, folder, file), "utf8"))
      const parsed = ModelDesignSchema.safeParse(specimen.model ?? specimen)
      if (parsed.success) found.push([`look ${folder}/${file}`, parsed.data])
    }
  return found
}

// What "the same design" means for a round trip: the hierarchy, every pivot and rotation, every box (name, place, size) and which bones
// each animation moves, with the keys of every track. Face colors and surface details are the texture's, which the round trip carries
// in the file's atlas; they are compared where the atlas can hold them exactly (see the dedicated test).
// The importer gives every bone a channel in every clip (a rest key where the file animates nothing), so a clip's channels are compared
// for the bones the original animated, and every other channel must be that rest key and nothing else.
function geometryOf(design: ModelDesign, animated?: ModelDesign) {
  return {
    name: design.name,
    texture_size: design.texture_size,
    budget: design.budget ?? null,
    bones: design.bones.map((bone) => ({
      name: bone.name,
      parent: bone.parent,
      pivot: bone.pivot,
      rotation: bone.rotation,
      cubes: bone.cubes.map((cube) => ({ name: cube.name, origin: cube.origin, size: cube.size })),
    })),
    animations: design.animations.map((animation) => ({
      name: animation.name,
      length: animation.length,
      loop: animation.loop,
      channels: animation.channels
        .filter((channel) => !animated || animated.animations.find((clip) => clip.name === animation.name)?.channels.some((own) => own.bone === channel.bone))
        .map((channel) => ({ bone: channel.bone, rotation: channel.keyframes, position: channel.position, scale: channel.scale }))
        .sort((a, b) => a.bone.localeCompare(b.bone)),
    })),
  }
}

describe("a model Studio exports comes back in as the same model", () => {
  const models = shippedModels()

  test("the fixtures are really there", () => {
    expect(models.length).toBeGreaterThanOrEqual(10)
    // The bundled example repeats box names ("leg", "hoof") across bones and names a box like its bone ("tail"): the cases that once failed.
    const names = mushroomCowDesign.bones.flatMap((bone) => bone.cubes.map((cube) => cube.name))
    expect(new Set(names).size).toBeLessThan(names.length)
    expect(mushroomCowDesign.bones.some((bone) => bone.cubes.some((cube) => cube.name === bone.name))).toBe(true)
  })

  for (const [label, design] of models) test(`${label}: export, import and the saved-model check agree`, () => {
    const exported = designToBlockbench(design)
    const imported = blockbenchToDesign(exported)
    expect(geometryOf(imported, design)).toEqual(geometryOf(design))
    const extra = imported.animations.flatMap((clip) => clip.channels.filter((channel) => !design.animations.find((own) => own.name === clip.name)?.channels.some((own) => own.bone === channel.bone)))
    expect(extra.every((channel) => !channel.position && !channel.scale && channel.keyframes.length === 1 && channel.keyframes[0]!.time === 0 && channel.keyframes[0]!.rotation.every((value) => value === 0))).toBe(true)
    // The check a save runs: the design made from the file still describes the file, and compiling it keeps every box where it was.
    const compiled = compileSavedModel({ design: imported, blockbench: exported }, "round_trip")
    const original = compileSavedModel(design, "round_trip")
    const geometry = (value: typeof compiled) => value.geometry["minecraft:geometry"][0].bones.map((bone) => ({ name: bone.name, parent: bone.parent, pivot: bone.pivot, cubes: bone.cubes.map((cube) => ({ origin: cube.origin, size: cube.size })) }))
    expect(geometry(compiled)).toEqual(geometry(original))
    // Importing what was imported changes nothing: the second trip is the same file.
    expect(geometryOf(blockbenchToDesign(designToBlockbench(imported)), design)).toEqual(geometryOf(design))
  })

  test("a flat-colored model keeps its face colors too", () => {
    const flat = ModelDesignSchema.parse(JSON.parse(readFileSync(path.join(import.meta.dir, "fixtures/pre-0a/model-asset.json"), "utf8")).data.design)
    const imported = blockbenchToDesign(designToBlockbench(flat))
    expect(imported.bones.flatMap((bone) => bone.cubes.map((cube) => cube.faces))).toEqual(flat.bones.flatMap((bone) => bone.cubes.map((cube) => cube.faces)))
  })
})

// A model as Blockbench itself writes it: elements and groups are told apart by uuid, any number may share a name, and the elements array
// is in creation order rather than the order the outliner shows.
const faces = (uv: [number, number, number, number], color: number) =>
  Object.fromEntries(["north", "east", "south", "west", "up", "down"].map((face) => [face, { uv, texture: null, color }]))
const element = (uuid: string, name: string, from: [number, number, number], to: [number, number, number], color: number) => ({ uuid, name, type: "cube", from, to, origin: [0, 0, 0], rotation: [0, 0, 0], faces: faces([0, 0, 1, 1], color) })
const group = (uuid: string, name: string, origin: [number, number, number], children: unknown[], rotation: [number, number, number] = [0, 0, 0]) => ({ uuid, name, origin, rotation, children })

function duplicateNames() {
  return {
    meta: { format_version: "4.10", model_format: "free", box_uv: false },
    name: "twin legs",
    resolution: { width: 64, height: 64 },
    elements: [
      element("e-a", "Cube", [-4, 8, -2], [4, 16, 2], 0xaa5533),
      element("e-b", "Cube", [-4, 0, -2], [-2, 8, 0], 0x3355aa),
      element("e-c", "Cube", [2, 0, -2], [4, 8, 0], 0x33aa55),
      element("e-d", "Cube", [-3, 16, -3], [3, 22, 3], 0xaaaa33),
      element("e-e", "leg", [-1, 0, 1], [1, 6, 3], 0x888888),
    ],
    outliner: [
      group("g-root", "body", [0, 8, 0], [
        "e-a",
        // Two groups with one name, and a box named like the bone of a group that comes later in the file.
        group("g-leg-1", "leg", [-3, 8, -1], ["e-b"], [10, 0, 0]),
        group("g-leg-2", "leg", [3, 8, -1], ["e-c"]),
        group("g-head", "Cube", [0, 16, 0], ["e-d", "e-e"]),
        group("g-tail", "leg_1", [0, 4, 2], []),
      ]),
    ],
    animations: [
      {
        name: "walk",
        length: 1,
        loop: true,
        animators: {
          "g-leg-1": { name: "leg", type: "bone", keyframes: [{ time: 0, channel: "rotation", data_points: [{ x: 20, y: 0, z: 0 }] }, { time: 0.5, channel: "rotation", data_points: [{ x: -20, y: 0, z: 0 }] }] },
          "g-leg-2": { name: "leg", type: "bone", keyframes: [{ time: 0, channel: "rotation", data_points: [{ x: -20, y: 0, z: 0 }] }, { time: 0.5, channel: "rotation", data_points: [{ x: 20, y: 0, z: 0 }] }] },
        },
      },
    ],
  }
}

describe("a Blockbench model whose names repeat", () => {
  test("gets one bone per group and keeps every pivot, rotation, hierarchy and the animation each bone has", () => {
    const design = blockbenchToDesign(duplicateNames())
    // Groups are found by uuid; the design's bone names are made from theirs and told apart in file order.
    expect(design.bones.map((bone) => [bone.name, bone.parent])).toEqual([["body", null], ["leg", "body"], ["leg_1", "body"], ["Cube", "body"], ["leg_1_1", "body"]])
    expect(design.bones.map((bone) => bone.pivot)).toEqual([[0, 8, 0], [-3, 8, -1], [3, 8, -1], [0, 16, 0], [0, 4, 2]])
    expect(design.bones[1]!.rotation).toEqual([10, 0, 0])
    // The animation of each leg stays with its own leg, though both are called "leg" in the file.
    const walk = design.animations.find((animation) => animation.name === "walk")!
    const rotationOf = (bone: string) => walk.channels.find((channel) => channel.bone === bone)!.keyframes.map((key) => key.rotation)
    expect(rotationOf("leg")).toEqual([[20, 0, 0], [-20, 0, 0]])
    expect(rotationOf("leg_1")).toEqual([[-20, 0, 0], [20, 0, 0]])
  })

  test("boxes with one name sit side by side in a bone, each told apart, and in the order the group lists them", () => {
    const project = duplicateNames()
    // The outliner lists e-e before e-d, against the elements array: the saved-model check pairs them by that listing.
    project.outliner[0]!.children[3] = group("g-head", "Cube", [0, 16, 0], ["e-e", "e-d"])
    const design = blockbenchToDesign(project)
    const head = design.bones.find((bone) => bone.name === "Cube")!
    expect(head.cubes.map((cube) => [cube.name, cube.origin])).toEqual([["leg", [-1, 0, 1]], ["Cube", [-3, 16, -3]]])
  })

  test("two boxes of one group with one name get told apart inside it", () => {
    const project = duplicateNames()
    project.outliner[0]!.children[0] = "e-a"
    project.outliner = [group("g-only", "all", [0, 0, 0], ["e-a", "e-b", "e-c", "e-d", "e-e"])] as never
    const design = blockbenchToDesign(project)
    expect(design.bones[0]!.cubes.map((cube) => cube.name)).toEqual(["Cube", "Cube_1", "Cube_2", "Cube_3", "leg"])
  })

  test("the saved-model check finds every group by its uuid and keeps the file's own box names", () => {
    const project = duplicateNames()
    ;(project as Record<string, unknown>).textures = [designToBlockbench(mushroomCowDesign).textures![0]]
    ;(project as Record<string, unknown>).resolution = { width: 256, height: 256 }
    const design = blockbenchToDesign(project)
    expect(design.texture_size).toBe(256)
    for (const element of project.elements) for (const face of Object.values(element.faces)) (face as { texture: number | null }).texture = 0
    const compiled = compileSavedModel({ design, blockbench: project }, "twin")
    const bones = compiled.geometry["minecraft:geometry"][0].bones
    expect(bones.map((bone) => bone.name)).toEqual(["body", "leg", "leg_1", "Cube", "leg_1_1"])
    expect(bones.find((bone) => bone.name === "leg_1")!.cubes[0]).toMatchObject({ name: "Cube", uuid: "e-c" })
    expect(compiled.animation.animations["animation.twin.walk"].bones.leg_1.rotation["0.0"]).toEqual([-20, 0, 0])
  })

  test("design names come from the groups alone, the same on both sides", () => {
    expect(boneNamesFor(["a", "a", "a_1", "a"])).toEqual(["a", "a_1", "a_1_1", "a_2"])
    expect(boneNamesFor(["Left Leg", "Left-Leg", "", "9lives"])).toEqual(["Left_Leg", "Left_Leg_1", "part", "lives"])
    expect(boneNamesFor(["x".repeat(60), "x".repeat(60)])).toEqual(["x".repeat(48), `${"x".repeat(46)}_1`])
  })
})

describe("a model Studio cannot take in is refused in words that name what is wrong", () => {
  const refusal = (project: unknown) => {
    try {
      blockbenchToDesign(project)
    } catch (error) {
      expect(error).toBeInstanceOf(BlockbenchImportError)
      return (error as BlockbenchImportError).message
    }
    throw new Error("expected a refusal")
  }

  test("two outermost groups", () => {
    const project = duplicateNames()
    project.outliner.push(group("g-second", "extra", [0, 0, 0], []))
    expect(refusal(project)).toContain("最外层有 2 个组（「body」、「extra」）")
  })

  test("no group at all", () => {
    const project = duplicateNames()
    project.outliner = []
    expect(refusal(project)).toContain("还没有骨骼")
  })

  test("boxes outside every group", () => {
    const project = duplicateNames()
    project.outliner[0]!.children.pop()
    project.outliner[0]!.children[3] = group("g-head", "Cube", [0, 16, 0], ["e-d"])
    expect(refusal(project)).toContain("有 1 个方块不在任何组里（「leg」）")
  })

  test("a box whose size is not a whole number names the box, its bone and the axis", () => {
    const project = duplicateNames()
    project.elements[4]!.to = [1.5, 6, 3]
    expect(refusal(project)).toBe("骨骼「Cube」里的方块「leg」的宽是 2.5，Studio 的方块大小只能是 1 到 256 之间的整数。请在 Blockbench 里把它改成整数大小，再导入。")
  })

  test("a box past the edge of the model space", () => {
    const project = duplicateNames()
    project.elements[0]!.to = [300, 16, 2]
    expect(refusal(project)).toContain("「Cube」")
  })

  test("a file that is not a model", () => {
    expect(refusal({ elements: "no" })).toContain("读不出来")
  })
})

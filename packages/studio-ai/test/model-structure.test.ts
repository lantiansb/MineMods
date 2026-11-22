import { expect, test } from "bun:test"
import { ModelDesignSchema } from "../src/contracts"
import { modelStructure, structureWords } from "../src/model-structure"
import specimen from "./fixtures/look/good/crystal-guardian.json"

test("measures rest angles through ancestors, linear chains, followed chains and empty joints", () => {
  const original = ModelDesignSchema.parse(specimen.model)
  const cube = original.bones.flatMap((bone) => bone.cubes)[0]!
  const joint = (name: string, parent: string | null): typeof original.bones[number] => ({
    name, parent, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [],
  })
  const bones = [
    joint("body", null),
    { ...joint("tail_1", "body"), rotation: [0, 22.5, 0] as [number, number, number] },
    { ...joint("tail_2", "tail_1"), cubes: [cube] },
    { ...joint("tail_3", "tail_2"), cubes: [cube] },
    { ...joint("plate", "body"), rotation: [0, 90, 0] as [number, number, number], cubes: [{ ...cube, rotation: [5, 0, 0] as [number, number, number] }, { ...cube, rotation: null }] },
  ]
  const design = { bones, follow: [{ bone: "tail_2" }] }
  const counts = modelStructure(design)
  expect(counts).toMatchObject({ depth: 4, bones: 5, joints: 2, cubes: 4, angled: 3 })
  expect(counts.chains).toEqual([{ names: ["tail_1", "tail_2", "tail_3"], followed: ["tail_2"] }])
  expect(structureWords(design)).toContain("非正放方块 3/4（75%）")
})

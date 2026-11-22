import { expect, test } from "bun:test"
import { poseModel } from "../script/target-pose-sample"
import { blockbenchToDesign, designToBlockbench } from "../src/blockbench"
import { keptPlayWords } from "../src/blockbench-keys"

test("编辑器导出后保留看向、摆动和每个动作的权重", () => {
  const original = poseModel(2)
  const file = designToBlockbench(original)
  const converted = blockbenchToDesign(file)
  const kept = keptPlayWords(converted, original)
  expect(kept.look).toEqual(original.look)
  expect(kept.sway).toEqual(original.sway)
  expect(kept.animations.map(c => c.weights)).toEqual(original.animations.map(c => c.weights))
  const shortened = keptPlayWords({...converted, animations: converted.animations.map(c => ({...c, length: 1.75}))}, original)
  const track = shortened.animations.find(c => c.weights?.look)?.weights?.look
  expect(track?.at(-1)?.time).toBe(1.75)
  expect(track?.at(-1)?.value).toBeCloseTo(0.5)
})


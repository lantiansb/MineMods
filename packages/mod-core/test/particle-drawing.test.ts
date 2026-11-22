import { expect, test } from "bun:test"
import { runDrawing } from "../src/script-run"
import { particlePixels } from "../src/particle"

test("particle drawings keep alpha and expose shapes only to particle scripts", async () => {
  const source = 'const c=api.shape("ember",{side:8,seed:4}); c.set(0,0,"#22446677");return [c,api.canvas(8,8,null)]'
  const result = await runDrawing(source, { particle: true })
  if (!result.ok) throw Error(result.error)
  expect(Array.from(particlePixels(result.texture).pixels.slice(0, 4))).toEqual([34, 68, 102, 119])
  expect(result.variants.length).toBe(1)
  expect((await runDrawing(source)).ok).toBe(false)
  for (const invalid of [
    "[api.canvas(2,1,null)]",
    "[api.canvas(2,2,null),api.canvas(4,4,null)]",
    "Array(9).fill(api.canvas(2,2,null))",
  ])
    expect((await runDrawing("return " + invalid, { particle: true })).ok).toBe(false)
})

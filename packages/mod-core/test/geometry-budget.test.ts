import { expect, test } from "bun:test"
import { GEOMETRY_TIERS } from "@minemods/studio-ai/budget"
import { fitModelAtlas } from "../src/model"
import { runScript } from "../src/script-run"
import { getModuleSchema } from "../src/workspace"

// Rows of small boxes, a bone to every 32, three motions that turn the first bone: nothing in particular.
const rows = (cubes: number, budget: string | null, extra = "") => `
const m = api.model({ name: "rows"${budget ? `, budget: "${budget}"` : ""} })
const root = m.bone("root")
for (let i = 0; i < ${cubes}; i++) (i % 32 ? m.get("p" + Math.floor(i / 32)) : root.bone("p" + i / 32, { pivot: [0, i / 32, 0] })).cube("c" + i, { origin: [(i % 32) * 3 - 48, Math.floor(i / 32) * 3, 0], size: [4, 4, 4], color: "#7f8f9f" })
for (const name of ["idle", "walk", "hurt"]) m.animation(name, { length: 1, loop: name !== "hurt" }).keys("p0", [[0, [0, 0, 0]], [0.5, [20, 0, 0]], [1, [0, 0, 0]]])
${extra}
return m.document()`

test("脚本做的模型守它自己的档：不写就是原来的 256 个方块；写高一档能做更多，贴图跟着放大，文档里记着这一档", async () => {
  const plain = await runScript("model", rows(256, null))
  expect(plain).toMatchObject({ ok: true, summary: { cubes: 256 } })
  expect((plain as { document: object }).document).not.toHaveProperty("budget")
  expect(await runScript("model", rows(257, null))).toMatchObject({ ok: false, error: expect.stringContaining("方块太多了：「普通」档一个模型最多 256 个，这是第 257 个。") })
  const fine = await runScript("model", rows(GEOMETRY_TIERS.fine.cubes, "fine"))
  expect(fine).toMatchObject({ ok: true, document: { budget: "fine" }, summary: { cubes: GEOMETRY_TIERS.fine.cubes } })
  // Its faces fit no texture of the default tier; its own tier's is tried, and nothing is left out of it.
  const { kind: _kind, ...design } = (fine as { document: { kind: "model"; budget?: "fine" } & Record<string, unknown> }).document
  const compiled = fitModelAtlas(design, "rows")
  expect(compiled.design.texture_size).toBe(512)
  expect(compiled.geometry["minecraft:geometry"][0]!.bones.reduce((sum, bone) => sum + bone.cubes.length, 0)).toBe(GEOMETRY_TIERS.fine.cubes)
  expect(() => fitModelAtlas({ ...design, budget: undefined }, "rows")).toThrow("方块超出了「普通」档的上限")
  expect(await runScript("model", rows(8, "huge"))).toMatchObject({ ok: false, error: expect.stringContaining("budget 只能是 standard、fine、finest、epic 之一") })
})

test("单独的动画和贴图也跟着档走：带动的骨骼多于 64 根要写明档位，贴图可以和高一档的模型一样大", () => {
  const motion = (bones: number, budget?: string) => getModuleSchema("animation").safeParse({ kind: "animation", name: "wave", length: 1, loop: true, ...(budget ? { budget } : {}), channels: Array.from({ length: bones }, (_, index) => ({ bone: `b${index}`, keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [10, 0, 0] }] })) })
  expect(motion(64).success).toBe(true)
  expect(motion(65).error?.issues[0]?.message).toContain("骨骼超出了「普通」档的上限：这段动作带动的骨骼有 65 根，这一档最多 64 根，多了 1 根")
  expect(motion(65, "fine").success).toBe(true)
  const texture = (side: number) => getModuleSchema("texture").safeParse({ kind: "texture", width: side, height: side, palette: ["#808080"], pixels: Array.from({ length: side * side }, () => 0) }).success
  expect(texture(512)).toBe(true)
  // 第 1 步: the epic tier's model texture is 1024, so a texture drawn for it may be too.
  expect(texture(1024)).toBe(true)
  expect(texture(1025)).toBe(false)
})

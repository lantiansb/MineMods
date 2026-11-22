import { expect, test } from "bun:test"
import { Glob } from "bun"
import path from "node:path"
import { reviewAsset, told } from "../src/acceptance"
import { modelBounds } from "../src/model-bounds"
import { fitModelAtlas } from "../src/model"
import { ProjectSchema } from "../src/project"
import { runScript, SCRIPT_GUIDE, SCRIPT_LIMITS } from "../src/script-run"
import type { ModuleDocument } from "../src/workspace"

// The scripts under fixtures/script are evidence that the medium scales and is not about any one kind of
// thing. They are test fixtures: nothing in the product reads them and no AI is ever shown them.

type Model = Extract<ModuleDocument, { kind: "model" }>
const folder = path.join(import.meta.dir, "fixtures", "script")
const made = async (name: string) => {
  const ran = await runScript("model", await Bun.file(path.join(folder, `${name}.js`)).text())
  if (!ran.ok) throw new Error(`${name}: ${ran.error}`)
  return { ...ran, model: ran.document as Model }
}
const project = ProjectSchema.parse({ schema_version: 1, id: "00000000-0000-4000-8000-000000000001", mod_id: "fixture", name: "夹具", description: "", revision: 0, target: "fabric-1.21.1", created_at: "2026-10-05T00:00:00.000Z", updated_at: "2026-10-05T00:00:00.000Z", assets: [], entities: [] })
const judged = (model: Model, brief: string) =>
  reviewAsset(project, { id: "00000000-0000-4000-8000-00000000a001", module: "model", title: model.name, revision: 1, created_at: "2026-10-05T00:00:00.000Z", updated_at: "2026-10-05T00:00:00.000Z", prompt: brief, dependencies: [], document: model, provenance: { model: null, request_id: null }, status: "saved" } as Parameters<typeof reviewAsset>[1], { complexity: "high", brief })

test("脚本撑得起大东西：一只长脖子带翅膀的大型生物，一百五十多个方块、四十多根骨骼，过得了验收标准", async () => {
  const flyer = await made("long-necked-flyer")
  expect(flyer.summary).toMatchObject({ kind: "model", bones: 42, cubes: 153, texture_size: 256 })
  expect(flyer.notes).toEqual(["bones 42, cubes 153, animations 4"])
  const bones = flyer.model.bones.map((bone) => bone.name)
  // Chains: each piece hangs from the one before it.
  ;[["neck", 6], ["tail", 8]].forEach(([stem, count]) => {
    const chain = Array.from({ length: count as number }, (_, index) => flyer.model.bones.find((bone) => bone.name === `${stem}_${index + 1}`)!)
    expect(chain.every(Boolean)).toBe(true)
    chain.slice(1).forEach((bone, index) => expect(bone.parent).toBe(chain[index]!.name))
  })
  // A wing of an arm, a forearm and four fingers with thin skin between them; the other side is its mirror.
  expect(bones.filter((name) => /^wing_r/.test(name))).toEqual(["wing_r", "wing_r_fore", "wing_r_finger_1", "wing_r_finger_2", "wing_r_finger_3", "wing_r_finger_4"])
  expect(bones.filter((name) => /^wing_l/.test(name))).toHaveLength(6)
  const skins = flyer.model.bones.filter((bone) => /^wing_/.test(bone.name)).flatMap((bone) => bone.cubes.filter((cube) => cube.name.startsWith("skin")))
  expect(skins.length).toBeGreaterThanOrEqual(30)
  expect(skins.every((cube) => cube.size[1] === 1)).toBe(true)
  const right = flyer.model.bones.find((bone) => bone.name === "wing_r_finger_2")!
  const left = flyer.model.bones.find((bone) => bone.name === "wing_l_finger_2")!
  expect(left.pivot).toEqual([-right.pivot[0], right.pivot[1], right.pivot[2]])
  expect(left.rotation).toEqual([right.rotation[0], -right.rotation[1] + 0, -right.rotation[2] + 0])
  expect(flyer.model.animations.map((motion) => motion.name)).toEqual(["idle", "walk", "hurt", "flap"])
  expect(flyer.model.animations.find((motion) => motion.name === "flap")!.channels.length).toBeGreaterThan(20)
  // It stands on the ground, fits a texture, and the standard for a high-detail model has nothing against it.
  const { kind: _kind, ...design } = flyer.model
  expect(modelBounds(design).min[1]).toBeCloseTo(0, 1)
  expect(() => fitModelAtlas(design, "fixture")).not.toThrow()
  const review = judged(flyer.model, "一只长脖子、有翅膀的大型飞龙：四条腿，长尾巴，头上有角，翅膀有指骨和翼膜")
  expect(told(review).findings.map((finding) => `${finding.criterion}：${finding.message}`)).toEqual([])
  expect(review.passed).toBe(true)
}, 30_000)

test("脚本不挑题材：机器、植物、家具，都是同一套材料写出来的", async () => {
  const wheel = await made("water-wheel")
  expect(wheel.summary).toMatchObject({ bones: 17, cubes: 62 })
  // Twelve spokes from one loop, each turned a twelfth of the circle further.
  expect(wheel.model.bones.filter((bone) => bone.name.startsWith("spoke_")).map((bone) => bone.rotation[0])).toEqual(Array.from({ length: 12 }, (_, index) => index * 30))
  const fern = await made("potted-fern")
  expect(fern.summary).toMatchObject({ bones: 34, cubes: 69 })
  // Seeded: the same fern every time.
  expect((await made("potted-fern")).model).toEqual(fern.model)
  const shelf = await made("bookshelf")
  expect(shelf.summary).toMatchObject({ bones: 6 })
  // Faces drawn on a canvas arrive as the document's ordinary marks.
  const drawn = shelf.model.bones.flatMap((bone) => bone.cubes).filter((cube) => cube.surface_details.length > 0)
  expect(drawn.length).toBeGreaterThan(20)
  expect(drawn.every((cube) => cube.surface_details.every((detail) => detail.face === "north"))).toBe(true)
  // None of them is refused for being broken: nothing floats, nothing is buried, every one fits its texture.
  ;[wheel, fern, shelf].forEach((thing) => {
    const { kind: _kind, ...design } = thing.model
    expect(() => fitModelAtlas(design, "fixture")).not.toThrow()
    expect(told(judged(thing.model, thing.model.name)).findings.filter((finding) => finding.criterion === "站得住")).toEqual([])
  })
})

test("夹具只是夹具：产品里没有它们，给 AI 的说明里也没有", async () => {
  const names = [...new Glob("*.js").scanSync(folder)].sort()
  expect(names).toEqual(["bookshelf.js", "long-necked-flyer.js", "potted-fern.js", "water-wheel.js"])
  const sources = await Promise.all([...new Glob("{mod-core,studio-ai,studio,ai-service}/src/**/*.{ts,tsx}").scanSync(path.join(import.meta.dir, "..", ".."))].map((file) => Bun.file(path.join(import.meta.dir, "..", "..", file)).text()))
  expect(sources.length).toBeGreaterThan(100)
  expect(sources.filter((text) => /fixtures\/script|long-necked-flyer|potted-fern|water-wheel\.js|bookshelf\.js/.test(text))).toEqual([])
  expect(/\b(wing|neck|tail|finger|spoke|frond|shelf)\b/.test(SCRIPT_GUIDE)).toBe(false)
  // Each stays inside the limits a script is held to.
  const texts = await Promise.all(names.map((name) => Bun.file(path.join(folder, name)).text()))
  texts.forEach((text) => expect(text.length).toBeLessThan(SCRIPT_LIMITS.source))
})

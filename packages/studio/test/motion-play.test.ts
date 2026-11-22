import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Project } from "@minemods/mod-core/project"
import { playableMotions } from "../src/renderer/features/motion-play-model"
import { createDataGameplaySample } from "../../mod-core/script/data-gameplay-sample"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

async function fighting() {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-motion-play-"))
  directories.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"), { life: true, abilities: true })
  const model = project.workspace.assets.find((asset) => asset.document.kind === "model")!
  return { project, model, document: model.document as Extract<typeof model.document, { kind: "model" }> }
}

test("a model's motions are listed to play, each named with the ability that plays it", async () => {
  const { project, model, document } = await fighting()
  const list = playableMotions(project, { model_asset_id: model.id, entity_id: null })
  expect(list.map((value) => value.name)).toEqual(document.animations.map((value) => value.name))
  const label = (name: string) => list.find((value) => value.name === name)!.label
  // Neither is a common motion with a word of its own, so the ability's name is what the button says.
  expect(label("slam")).toBe("招式：重锤")
  expect(label("burst")).toBe("招式：晶刺喷射")
  // Common motions have a display name even when no ability plays them.
  expect(label("wave")).toBe("挥动")
})

// Broad22/23: the buttons showed 「lay」 and 「spike_ring」 as the model file spells them.
test("a button never shows a motion's file name when something in the project says what the motion is", async () => {
  const { project, model, document } = await fighting()
  const bone = document.bones[0]!.name
  const motion = (name: string) => ({ name, length: 1, loop: false, channels: [{ bone, keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] })
  const withMotions = { ...model, document: { ...document, animations: [...document.animations, motion("lay"), motion("wiggle"), motion("emerge"), motion("hover")] } }
  const saved = { ...model, id: "a-nod", title: "点点头", dependencies: [model.id], document: { kind: "animation", ...motion("nod") } }
  // A gameplay of the project whose code starts the motion `lay` on this creature.
  const gameplay = {
    ...model,
    id: "gp-egg",
    title: "working label",
    dependencies: [],
    document: { kind: "gameplay", name: "母鸡下蛋", uses: [model.id], sources: [{ path: "Egg.java", content: `class Egg { void tick(Object mob) { ProjectContent.playMotion(mob, "lay"); } }` }] },
  }
  const assets = [...project.workspace.assets.map((asset) => (asset.id === model.id ? withMotions : asset)), saved, gameplay]
  const next = { ...project, workspace: { ...project.workspace, assets } } as unknown as Project
  const list = playableMotions(next, { model_asset_id: model.id, entity_id: null })
  const label = (name: string) => list.find((value) => value.name === name)!.label
  // 1. a title in the person's language that the motion's own record carries
  expect(label("nod")).toBe("点点头")
  // 2. the table of common motions
  expect([label("emerge"), label("hover"), label("idle")]).toEqual(["破土而出", "悬停", "待机"])
  // 3. the gameplay (or ability) that plays it
  expect(label("lay")).toBe("玩法：母鸡下蛋")
  expect(label("slam")).toBe("招式：重锤")
  // 4. Unnamed motions keep their internal ID for playback without putting it on the button.
  expect(label("wiggle")).toBe("未命名动作")
  // Whatever has a name of its own never shows the file name on the ordinary view.
  for (const name of ["nod", "emerge", "hover", "idle", "lay", "slam", "burst"]) expect(label(name)).not.toContain(name)
})

test("a creature whose model is only in the compiled shape is not claimed to be unable to move: its list is empty and the stage still plays it", async () => {
  const { project } = await fighting()
  const creature = project.entities[0]!
  // The creature's model file id is not a saved model; the overview names the saved model it is shown on, and that is what the list is read from.
  expect(playableMotions(project, { model_asset_id: null, entity_id: creature.id })).toEqual([])
})

test("a motion saved on its own is offered only when every part it moves is on the model", async () => {
  const { project, model, document } = await fighting()
  const bone = document.bones[0]!.name
  const saved = (id: string, name: string, part: string) => ({
    ...model,
    id,
    dependencies: [model.id],
    document: { kind: "animation", name, length: 1, loop: true, channels: [{ bone: part, position: [] }] },
  })
  const extended = { ...project, workspace: { ...project.workspace, assets: [...project.workspace.assets, saved("a-ok", "nod", bone), saved("a-bad", "tailflick", "no-such-part")] } } as unknown as Project
  const names = playableMotions(extended, { model_asset_id: model.id, entity_id: null }).map((value) => value.name)
  expect(names).toContain("nod")
  expect(names).not.toContain("tailflick")
  // One that has the same name as the model's own is not offered twice.
  const twice = { ...project, workspace: { ...project.workspace, assets: [...project.workspace.assets, saved("a-dup", "slam", bone)] } } as unknown as Project
  expect(playableMotions(twice, { model_asset_id: model.id, entity_id: null }).filter((value) => value.name === "slam")).toHaveLength(1)
})

test("a thing with no saved model has nothing to play, and the entry says so by not being there", async () => {
  const { project } = await fighting()
  expect(playableMotions(project, { model_asset_id: null, entity_id: null })).toEqual([])
  expect(playableMotions(project, { model_asset_id: "missing", entity_id: null })).toEqual([])
})

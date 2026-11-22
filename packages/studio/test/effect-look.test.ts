import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { EFFECT_UNPLAYED_MARK } from "@minemods/mod-core/effect"
import { TEXTURE_SPACE_ERROR } from "@minemods/studio-ai/model-paint"
import { effectLookup, type EffectEvent } from "@minemods/mod-core/effect-abilities"
import { MAKING_LIMITS, MakingRefusal } from "@minemods/mod-core/making"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { lookJob, needJob, reviewJob } from "../src/main/look-job"
import { describeAsset } from "../src/renderer/features/asset-words"
import { createDataGameplaySample } from "../../mod-core/script/data-gameplay-sample"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

/** The sample whose golem shows two effects while it fights, with its documents by kind. */
async function showing() {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-effects-"))
  directories.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"), { life: true, abilities: true, effects: true })
  const all = <Kind extends ModuleDocument["kind"]>(kind: Kind) => project.workspace.assets.flatMap((asset) => (asset.document.kind === kind ? [{ id: asset.id, document: asset.document as Extract<ModuleDocument, { kind: Kind }> }] : []))
  return { project, creature: all("entity")[0]!, model: all("model")[0]!, mark: all("effect")[0]!, spike: all("effect")[1]! }
}
const words = (run: () => unknown) => {
  try {
    run()
    return ""
  } catch (error) {
    return error instanceof MakingRefusal ? error.message : String(error)
  }
}

test("an effect alone is looked at like a model: every side, then its life frame by frame, with what was measured on it", async () => {
  const { mark, spike } = await showing()
  const made = lookJob(spike.document, null)
  expect(made.job.sheets.map((sheet) => [sheet.label, sheet.cells.length])).toEqual([["六个角度（它做好的样子）", 6], ["「rise」 · 斜前方", MAKING_LIMITS.frames]])
  // Its life is shot in the room it reaches over that life, so growing past its built pose stays in the picture; the last cell lays its two furthest moments over each other.
  const life = made.job.sheets[1]!.cells
  expect(life.every((cell) => (cell.kind === "view" || cell.kind === "compare") && cell.camera !== undefined)).toBe(true)
  expect(life.at(-1)).toMatchObject({ kind: "compare", animation: "rise" })
  expect(made.motion).toMatchObject([{ name: "rise", unseen: false }])
  expect(made.notes.join("\n")).toContain("它存在 0.5 秒（10 刻），从出现的那一刻起播动作「rise」")
  expect(made.notes.join("\n")).toContain("它最完整的时候是出现后第 0.1 秒")
  // What the pictures do not show of how the game draws it is said.
  expect(lookJob(mark.document, null).notes.join("\n")).toContain("这些图按实心、按普通光照画。游戏里它整个是半透明的（不透明度 0.65），不受周围明暗影响、一直最亮")
  expect(made.notes.join("\n")).not.toContain("这些图按实心")
  // A reviewer gets every side, the bare shape and the life from two directions; and may ask for more as with a model.
  expect(reviewJob(spike.document, null).job.sheets.map((sheet) => sheet.label)).toEqual(["六个角度（它做好的样子）", "只看形状", "「rise」 · 斜前方", "「rise」 · 它的左侧"])
  expect(needJob(spike.document, null, [{ what: "close_up", name: "shard" }, { what: "angle", name: "top" }]).job.sheets.map((sheet) => sheet.label)).toEqual(["近看「shard」", "从上往下（大图）"])
  expect(words(() => lookJob(spike.document, null, { animation: "sink" }))).toBe("这个效果里没有叫「sink」的动作。它有：rise。")
  expect(words(() => lookJob(spike.document, null, { close_up: "leaf" }))).toContain("这个效果里没有叫「leaf」的部件")
  // One that never changes is told so, as a motion nobody can see.
  const still = { ...mark.document, animations: [{ name: "open", length: 0.8, loop: false, channels: [{ bone: "frame", keyframes: [{ time: 0, rotation: [0, 0, 0] as [number, number, number] }] }] }] }
  expect(lookJob(still, null).notes.join("\n")).toContain("它从出现到消失看不出任何变化")
  expect(lookJob(still, null).motion).toMatchObject([{ unseen: true }])
})

// Round 17: 「动画为什么会有这么多个状态呢，这是必须要的吗？」 An effect's page listed idle, walk and hurt beside the one motion it plays.
test("an effect is drawn and reviewed with the motion it plays and no other; motions nothing plays are told at the look as something to take out", async () => {
  const { spike } = await showing()
  // The scenes a look and a review draw hold the effect's own motion only: nothing of a creature's is added on the way.
  for (const made of [lookJob(spike.document, null), reviewJob(spike.document, null)]) {
    expect(made.job.scenes.map((scene) => scene.design.animations.map((animation) => animation.name))).toEqual([["rise"], ["rise"]])
    expect(made.job.scenes[0]!.preview).not.toBeNull()
    expect(JSON.stringify(made.job.sheets)).not.toMatch(/idle|walk|hurt|待机|走路|受伤/)
  }
  expect(lookJob(spike.document, null).measured).toBeUndefined()
  // One that carries a creature's three all the same (an older project, or an AI that took the model's rule for its own): it is still looked at whole,
  // and the three come back as what they are, to be answered before it is called finished. The rule names no motion: any but the played one is one.
  const still = (name: string) => ({ name, length: 1, loop: true, channels: [{ bone: spike.document.bones[0]!.name, keyframes: [{ time: 0, rotation: [0, 0, 0] as [number, number, number] }] }] })
  const carried = lookJob({ ...spike.document, animations: [...spike.document.animations, still("idle"), still("walk"), still("hurt")] }, null)
  expect(carried.measured).toHaveLength(1)
  expect(carried.measured![0]).toStartWith(EFFECT_UNPLAYED_MARK)
  expect(carried.measured![0]).toContain("「idle」、「walk」、「hurt」在游戏里永远不会出现")
  expect(carried.job.sheets.map((sheet) => sheet.label)).toEqual(["六个角度（它做好的样子）", "「rise」 · 斜前方"])
  expect(lookJob({ ...spike.document, animations: [...spike.document.animations, still("fade")] }, null).measured![0]).toContain("「fade」在游戏里永远不会出现")
})

// An effect whose faces fit no texture of its tier looked fine and then failed to pack when the mod was built.
test("an effect that cannot be packed into its texture says so at the look, in the build's words, and the look of one that can says nothing", async () => {
  const { mark } = await showing()
  const wide = { ...mark.document, bones: mark.document.bones.map((bone, index) => (index ? bone : { ...bone, cubes: [{ ...bone.cubes[0]!, origin: [-75, 0, -75] as [number, number, number], size: [150, 20, 150] as [number, number, number] }, ...bone.cubes.slice(1)] })) }
  expect(lookJob(wide, null).notes).toContain(`照这一版造不出这个效果：${TEXTURE_SPACE_ERROR}图里画的是只有面的颜色、没有贴图的样子。`)
  // Still drawn, in its plain face colours; and at a texel over 2×2 model pixels it is built, so nothing is said.
  expect(lookJob(wide, null).job.scenes[0]!.preview).toBeNull()
  const coarse = lookJob({ ...wide, texel_size: 2 }, null)
  expect(coarse.notes.join("\n")).not.toContain("造不出")
  expect(coarse.job.scenes[0]!.preview).not.toBeNull()
  expect(lookJob(mark.document, null).notes.join("\n")).not.toContain("造不出")
})

test("an ability that shows effects is drawn twice: with them where it puts them, and the creature alone", async () => {
  const { project, creature, model } = await showing()
  const effects = effectLookup(project)
  const made = lookJob(creature.document, model.document, { animation: "slam" }, null, null, null, effects)
  expect(made.job.sheets.map((sheet) => sheet.label)).toEqual(["招式「重锤」· 和效果一起（红色是判定范围）", "招式「重锤」· 只看生物的动作（红色是判定范围）"])
  const together = made.job.sheets[0]!.cells.flatMap((cell) => (cell.kind === "hit" && !cell.light ? [cell] : []))
  // The hit moment from three sides, then the mark at its fullest (0.45 seconds after it appeared at 0.1) from three sides.
  expect(together.map((cell) => [cell.time, cell.view])).toEqual([[0.7, "plus_x"], [0.7, "top"], [0.7, "quarter"], [0.55, "plus_x"], [0.55, "top"], [0.55, "quarter"]])
  expect(together.map((cell) => cell.label)[3]).toBe("它的左侧 · 效果「落点标记」最完整的时候 0.55 秒")
  // The mark lets the world show through: the creature alone is drawn, and the mark, a scene of its own at its place in the same view, is laid over it at the mark's opacity.
  expect(together.every((cell) => cell.scene === 0 && cell.extra === undefined && cell.over?.length === 1 && cell.over[0]!.alpha === 0.65 && cell.over[0]!.scene === 0 && cell.over[0]!.extra?.length === 1)).toBe(true)
  const mark = together[0]!.over![0]!.extra![0]!
  expect(mark.scene).toBeGreaterThan(0)
  expect(made.job.scenes[mark.scene]!.design.bones.length).toBeGreaterThan(0)
  expect(mark.offset.every(Number.isFinite)).toBe(true)
  expect(together[2]!.caption.join("")).toContain("效果「落点标记」在第 0.1 秒出现：比蓄力结束早 0.4 秒，比第 0.7 秒的出手早 0.6 秒")
  expect(together[5]!.caption.join("")).toContain("中心都在第 1 次出手的判定范围里")
  // The creature alone is the picture it always was: no scene but the creature's, nothing laid over.
  const alone = made.job.sheets[1]!.cells.flatMap((cell) => (cell.kind === "hit" && !cell.light ? [cell] : []))
  expect(alone.map((cell) => [cell.scene, cell.over, cell.time, cell.view])).toEqual([[0, undefined, 0.7, "plus_x"], [0, undefined, 0.7, "top"], [0, undefined, 0.7, "quarter"]])
  // A solid effect is part of the picture itself, a scene of its own at its own place; six spikes in a row are all there at their fullest, and the first six still stand at the second thrust.
  const burst = lookJob(creature.document, model.document, { animation: "burst" }, null, null, null, effects)
  const cells = burst.job.sheets[0]!.cells.flatMap((cell) => (cell.kind === "hit" && !cell.light ? [cell] : []))
  expect(cells.map((cell) => [cell.time, cell.view])).toEqual([[1, "quarter"], [1.3, "quarter"], [1.1, "top"], [1.1, "quarter"], [1.4, "top"], [1.4, "quarter"]])
  expect(cells.every((cell) => cell.scene === 0 && cell.over === undefined && (cell.extra?.length ?? 0) > 0)).toBe(true)
  expect(cells[1]!.extra).toHaveLength(12)
  expect(cells[2]!.extra).toHaveLength(6)
  // The six in a row lie 1.5 blocks apart, straight ahead (the viewport's -Z): each at its own place.
  expect(cells[2]!.extra!.map((part) => part.offset[2] / -16)).toEqual([1.5, 3, 4.5, 6, 7.5, 9])
  // Everything at once is more pictures than one look holds: what was left out is named, with how to ask for one ability.
  const both = lookJob(creature.document, model.document, {}, null, null, null, effects)
  expect(both.job.sheets).toHaveLength(MAKING_LIMITS.sheets)
  expect(both.notes.join("\n")).toContain("这次没有画：招式「晶刺喷射」· 只看生物的动作（红色是判定范围）。只看一个招式的话，animation 写那个招式的 id 再看一次。")
  expect(words(() => lookJob(creature.document, model.document, { animation: "bite" }, null, null, null, effects))).toBe("这只生物没有叫「bite」的招式。它有：slam、burst。")
  // Without the project's effects the look is the one from before effects: one picture an ability.
  expect(lookJob(creature.document, model.document).job.sheets.map((sheet) => sheet.label)).toEqual(["招式「重锤」· 出手的那一刻（红色是判定范围）", "招式「晶刺喷射」· 2 次出手（红色是判定范围）"])
})

test("an effect that marks a hit but lies elsewhere is said on the picture and in the notes", async () => {
  const { project, creature, model } = await showing()
  const slam = creature.document.abilities![0]!
  const off = { ...creature.document, abilities: [{ ...slam, events: slam.events.map((event) => (event.type === "effect" ? { ...event, forward: 2.6, left: 1.5 } : event)) }] }
  const made = lookJob(off, model.document, {}, null, null, null, effectLookup(project))
  const finding = made.notes.find((note) => note.startsWith("对不上"))
  expect(finding).toContain("效果「落点标记」是放在第 1 次出手打到的地方的，可是它的中心在判定范围外面 1.63 格（超过 0.5 格")
  expect(made.job.sheets[0]!.cells.flatMap((cell) => (cell.kind === "hit" ? cell.caption : []))).toContain(finding!)
  // An effect the project no longer has is said as missing, and the ability is drawn without it.
  const lost = lookJob(creature.document, model.document, { animation: "slam" }, null, null, null, () => null)
  expect(lost.notes.find((note) => note.startsWith("缺："))).toContain("招式「重锤」第 0.1 秒要出现的效果在工程里找不到")
  expect(lost.job.scenes).toHaveLength(1)
})

test("the cards say an effect in a player's words, and a creature's card names the effects its abilities show", async () => {
  const { project, creature, mark } = await showing()
  const card = describeAsset(project, { id: mark.id, asset_id: mark.id, kind: "effect", preview: { source: "asset" } }, (reference) => reference)
  const row = (label: string) => card.rows.find((value) => value.label === label)!
  expect(row("存在多久").text).toBe("0.8 秒，一出现就从头播它自己的动作")
  expect(row("怎么待着").text).toBe("跟着放出它的那一方走，朝着放出它的那一方面朝的方向，贴在地面上；那一招被打断或者放出它的那一方死了，它立刻消失")
  expect(row("画法").text).toBe("不受明暗影响，一直最亮；整个半透明")
  expect(row("谁在用它").text).toBe("「晶石傀儡」的招式「重锤」")
  // Names as the document spells them stay behind 高级.
  expect(card.rows.map((value) => value.text).join("")).not.toMatch(/play\.|clip|opacity|ticks/)
  expect(row("存在多久").detail).toBe("play.clip open · 16 ticks")
  expect(card.notes).toEqual([])
  const owner = describeAsset(project, { id: creature.id, asset_id: creature.id, kind: "entity", preview: { source: "asset" } }, (reference) => reference)
  expect(owner.rows.find((value) => value.label === "招式「重锤」")!.text).toContain("第 0.1 秒在第 1 次出手打到的地方出现效果「落点标记」")
  expect(owner.rows.find((value) => value.label === "招式「晶刺喷射」")!.text).toContain("第 1 秒在自己脚下出现效果「地面晶刺」 ×6")
  expect(owner.rows.find((value) => value.label === "动作去向")!.text).toContain("出现的效果「落点标记」")
  expect(owner.notes.join("")).not.toContain("效果")
})

// ---- J2 (round 10): the look shows what happens when the target is not level with what aims at it ----

test("a hit that aims gets one picture with the target somewhere else: the hit tilted, the effects as the ability then puts them, and what was measured", async () => {
  const { project, creature, model, spike } = await showing()
  const effects = effectLookup(project)
  const burst = creature.document.abilities![1]!
  // The sample's own spikes lie on the ground: nothing is measured of them against a tilt, and no picture is spent on it.
  expect(lookJob(creature.document, model.document, { animation: "burst" }, null, null, null, effects).job.sheets[0]!.cells.some((cell) => cell.label.includes("目标站在"))).toBe(false)
  // The same spikes made to stand in the air along the beam, from its own feet, level: they leave the beam when the target is not level.
  const floats = (id: string) => (id === spike.id ? { title: "悬空的晶刺", document: { ...spike.document, play: { ...spike.document.play, on_ground: false } } } : effects(id))
  const shows = (change: Partial<EffectEvent>): typeof creature.document => ({
    ...creature.document,
    abilities: [{ ...burst, hits: burst.hits.slice(0, 1).map((hit) => (hit.type === "area" && hit.shape.type === "line" ? { ...hit, shape: { ...hit.shape, radius: 1 } } : hit)), events: burst.events.flatMap((event): typeof burst.events => (event.type !== "effect" ? [event] : event.at === 1 ? [{ ...event, up: 1.2, ...change }] : [])) }],
  })
  const level = lookJob(shows({}), model.document, {}, null, null, null, floats)
  const cells = level.job.sheets[0]!.cells.flatMap((cell) => (cell.kind === "hit" && !cell.light ? [cell] : []))
  // Three sides of the hit moment, the one with the target moved, then the effect at its fullest from the two sides that are left.
  expect(cells.map((cell) => cell.view)).toEqual(["plus_x", "top", "quarter", "plus_x", "top", "quarter"])
  const stood = cells[3]!
  expect(stood.label).toMatch(/^它的左侧 · 目标站在(同一块地上|比它高 [\d.]+ 格的地方)（小方框是目标）/)
  // Its outline is the tilted beam and a box the size of a player; the other cells keep the level beam.
  expect(stood.faces.length).toBe(cells[0]!.faces.length + 6)
  expect(stood.faces).not.toEqual(cells[0]!.faces)
  expect(stood.caption.join("")).toContain("对不上：第 1 次出手是朝目标瞄的")
  expect(level.notes.filter((note) => note.startsWith("对不上"))).toHaveLength(1)
  expect(level.notes.join("\n")).toContain("朝目标瞄的判定都画成水平的；只有标着「目标站在…」的那一格把目标放在别的高度")
  // Laid out along the aim: the same picture, drawn tilted, and nothing disagrees.
  const along = lookJob(shows({ hit: 0, along: "aim" }), model.document, {}, null, null, null, floats)
  const tilted = along.job.sheets[0]!.cells.flatMap((cell) => (cell.kind === "hit" && !cell.light ? [cell] : []))[3]!
  expect(tilted.label).toContain("目标站在比它高")
  expect(tilted.extra).not.toEqual(along.job.sheets[0]!.cells.flatMap((cell) => (cell.kind === "hit" && !cell.light ? [cell] : []))[5]!.extra)
  expect(along.notes.filter((note) => note.startsWith("对不上"))).toEqual([])
  expect(along.notes.join("\n")).toContain("是顺着这个方向摆的（along 写的是 aim），位置和朝向跟着一起倾斜")
  // The card says the same finding, with the creature's own height known from its model.
  const changed = { ...project, workspace: { ...project.workspace, assets: project.workspace.assets.map((asset) => (asset.id === spike.id ? { ...asset, document: floats(spike.id)!.document } : asset.id === creature.id ? { ...asset, document: shows({}) } : asset)) } } as typeof project
  const card = describeAsset(changed, { id: creature.id, asset_id: creature.id, kind: "entity", preview: { source: "asset" } }, (reference) => reference)
  expect(card.notes.join("")).toContain("第 1 次出手是朝目标瞄的，目标站得高或者低它会跟着倾斜，可是效果「地面晶刺」")
})

// broad21 P2-03: the card's big picture of a spike that rises out of the ground looked like a flat-topped column while the frame-by-frame material showed it rising and sinking.
// The card drew the pose it is built in; the frames were shot in the room everything it reaches fits. Now every picture of an effect is one shot of the same material.
test("the picture of an effect on its cover and on its card is its fullest moment in the room of its frames, not the pose it is built in", async () => {
  const { effectShot, lookCamera, projector } = await import("../src/renderer/look-camera")
  const { effectRoom, EffectDocumentSchema, effectMeasure } = await import("@minemods/mod-core/effect")
  const { posedCorners } = await import("@minemods/studio-ai/model-motion")
  const { spike } = await showing()
  // The same spike, built standing on the ground, that rises out of it by moving: under the ground at first, risen in the middle, sunk again at the end.
  const document = EffectDocumentSchema.parse({
    ...spike.document,
    animations: [{ name: "rise", length: 0.5, loop: false, channels: [{ bone: "root", keyframes: [], position: [{ time: 0, position: [0, -40, 0] }, { time: 0.15, position: [0, 0, 0] }, { time: 0.35, position: [0, 0, 0] }, { time: 0.5, position: [0, -40, 0] }] }] }],
  })
  const shot = effectShot(document)
  const found = effectMeasure(document)!
  // The moment is the fullest one of its own motion, and the motion is the one it plays.
  expect(shot.animation).toBe(document.play.clip)
  expect(shot.time).toBe(found.peak.seconds)
  expect(shot.time).toBeGreaterThanOrEqual(0.15)
  expect(shot.time).toBeLessThanOrEqual(0.35)
  // The cover of a look is that very shot: same motion, same moment, same camera.
  const cover = lookJob(document, null).cover.cells[0]!
  expect(cover).toMatchObject({ kind: "view", view: "quarter", animation: shot.animation, time: shot.time, camera: shot.camera })
  // Its frames are shot in the same room (the camera looks at the middle of the same box).
  const frames = lookJob(document, null).job.sheets[1]!.cells
  expect(frames.every((cell) => (cell.kind === "view" || cell.kind === "compare") && cell.camera !== undefined && cell.camera.target.every((value, axis) => Math.abs(value - shot.camera.target[axis]!) < 1e-9))).toBe(true)
  // Everything of it at that moment lands inside the picture, and so does every other moment of its life (the room is the room of the frames). The card used to draw the first moment of the
  // first motion framed on the pose it is built in: the spike, still under the ground, was out of that picture.
  const inside = (camera: typeof shot.camera, time: number) => {
    const flat = projector(camera, [192, 192])
    return posedCorners(document, document.animations[0]!, time).every((corner) => {
      const [x, y] = flat(corner as [number, number, number])
      return x >= 0 && x <= 192 && y >= 0 && y <= 192
    })
  }
  const built = posedCorners(document, null)
  const asBuilt = lookCamera({ min: [0, 1, 2].map((axis) => Math.min(...built.map((point) => point[axis]!))) as [number, number, number], max: [0, 1, 2].map((axis) => Math.max(...built.map((point) => point[axis]!))) as [number, number, number] }, "quarter", 1)
  expect(inside(asBuilt, 0)).toBe(false)
  for (const time of [0, 0.1, shot.time, 0.45, 0.5]) expect(inside(shot.camera, time)).toBe(true)
  expect(effectRoom(document).min[1]).toBeLessThan(0)
  // An effect that is its built pose all the time is shot as it always was in the room of its built pose.
  const sitting = EffectDocumentSchema.parse({ ...spike.document, animations: [{ name: "rise", length: 0.5, loop: false, channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] }] })
  expect(effectShot(sitting).time).toBe(effectMeasure(sitting)!.peak.seconds)
})

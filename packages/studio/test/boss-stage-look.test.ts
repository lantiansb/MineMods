import { expect, test } from "bun:test"
import { getModuleSchema, type ModuleDocument } from "@minemods/mod-core/workspace"
import { BOSS_STAGE_SHEET, SHAKE_SHEET, lookJob, reviewJob } from "../src/main/look-job"
import { changingAbilities, changingBoss, crownedGolemDesign } from "../../mod-core/script/target-boss-look-sample"
import { golemAbilities } from "../../mod-core/script/data-gameplay-sample"
import { looksAt } from "@minemods/mod-core/making"
import { decodeRgbaPng } from "@minemods/mod-core/png-decode"
import type { EffectLookup } from "@minemods/mod-core/effect-abilities"

/** Boss 能力 8 and 10 in the pictures: the boss's model in each stage of its fight, and each ability's shake (its reach and its strength over time). */

type Creature = Extract<ModuleDocument, { kind: "entity" }>
type Model = Extract<ModuleDocument, { kind: "model" }>
const golem = getModuleSchema("model").parse({ kind: "model", ...crownedGolemDesign }) as Model
const creature = (extra: Record<string, unknown> = {}) =>
  getModuleSchema("entity").parse({ kind: "entity", name: "变身石魔", description: "", health: 200, speed: 0.22, attack_damage: 8, behavior: "hostile", model_asset_id: "11111111-1111-4111-8111-111111111111", runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null }, ...extra }) as Creature
type Geometry = { "minecraft:geometry": { bones: { name: string; cubes: { uv: Record<string, { visible?: boolean }> }[] }[] }[] }
const faces = (geometry: unknown, bone: string) => (geometry as Geometry)["minecraft:geometry"][0]!.bones.find((value) => value.name === bone)!.cubes.flatMap((cube) => Object.values(cube.uv))

test("a boss's model in each stage: the bones hidden and dropped by then turned off, its own glowing parts as bright as the stage ends", () => {
  const made = reviewJob(creature({ boss: changingBoss, abilities: changingAbilities }), golem)
  const stages = made.job.sheets.find((sheet) => sheet.label === BOSS_STAGE_SHEET)!
  expect(stages.columns).toBe(3)
  expect(stages.cells.map((cell) => cell.label.split(" · ").slice(0, 2).join(" · "))).toEqual(["第一阶段（满血） · 斜前方", "第 2 阶段（血量 66% 以下） · 斜前方", "第 3 阶段（血量 33% 以下） · 斜前方"])
  const scenes = stages.cells.map((cell) => made.job.scenes[(cell as { scene: number }).scene]!)
  // The crown is hidden until the last stage; the left arm from the second (it came off); the head from the last.
  expect(scenes.map((scene) => ["crown", "arm_left", "head"].map((bone) => faces(scene.preview!.geometry, bone).every((face) => face.visible === false)))).toEqual([
    [true, false, false],
    [true, true, false],
    [false, true, true],
  ])
  // The second stage ends with its glow at full, the first at full as always: the pictures are painted with the glow; the words say every stage.
  expect(stages.cells[0]!.label).toContain("自身发光 100%")
  expect(stages.cells[2]!.label).toContain("显出 crown")
  expect(stages.cells[2]!.label).toContain("藏起 head")
  expect(made.notes.join("\n")).toContain("第 3 阶段（血量 33% 以下），模型变成：藏起「head」、显出「crown」")
  expect(made.notes.join("\n")).toContain("这次没有读到工程的贴图资产")
})

test("each ability's shake: the ring it reaches from above and its strength over time, against the cap of the project's runtime", () => {
  const made = reviewJob(creature({ boss: changingBoss, abilities: changingAbilities }), golem)
  const shakes = made.job.sheets.find((sheet) => sheet.label === SHAKE_SHEET)!
  expect(shakes.cells.map((cell) => cell.kind)).toEqual(["hit", "flat", "hit", "flat"])
  const ring = shakes.cells[0]!
  expect(ring.kind === "hit" && ring.view === "top" && ring.faces.length === 48 && ring.caption[0] === "半径 16 格（范围内一样强）").toBe(true)
  expect(shakes.cells[1]!.label).toContain("最强 5")
  expect(made.notes.join("\n")).toContain("同时在跑的晃屏加起来最多 8。")
  // Written as before, the old cap is said; a creature without a shake or a boss gets neither picture.
  const old = reviewJob(creature({ abilities: [{ ...golemAbilities[0], events: [{ type: "shake", at: 0.7, strength: 2, radius: 12, seconds: 1 }] }] }), golem)
  expect(old.notes.join("\n")).toContain("上限还是 3")
  expect(old.job.sheets.map((sheet) => sheet.label)).not.toContain(BOSS_STAGE_SHEET)
  const plain = lookJob(creature({ abilities: golemAbilities }), golem)
  expect(plain.job.sheets.map((sheet) => sheet.label)).toEqual(["招式「重锤」· 出手的那一刻（红色是判定范围）", "招式「晶刺喷射」· 2 次出手（红色是判定范围）"])
})

test("a boss without abilities whose model changes still has its stages drawn", () => {
  const made = lookJob(creature({ boss: changingBoss }), golem)
  expect(made.job.sheets.map((sheet) => sheet.label)).toEqual([BOSS_STAGE_SHEET])
})

test("评审图实际换上工程贴图、叠加发光，并标出和上一阶段的差别", () => {
  const wear = crypto.randomUUID(), glow = crypto.randomUUID()
  const size = golem.texture_size
  const base = creature({ boss: { ...changingBoss, phases: changingBoss.phases.map((phase, index) => ({
    ...phase, model: index === 0 ? { texture: { asset: wear } } : { glow: { texture: { asset: glow }, from: 0, to: 0.5, seconds: 1 } },
  })) } })
  const assets: EffectLookup = Object.assign(() => null, {
    texture: (id: string) => ({
      title: id === wear ? "深青衣" : "赤线",
      document: { kind: "texture" as const, width: size, height: size, palette: [id === wear ? "#101F29" : "#400800"], pixels: Array(size ** 2).fill(0) },
    }),
  })
  expect(looksAt(base)).toBe(true)
  const review = reviewJob(base, golem, null, null, null, assets)
  const stage = review.job.sheets.find((sheet) => sheet.label === BOSS_STAGE_SHEET)!
  expect(stage.cells[1]!.label).toContain("换上深青衣")
  expect(stage.cells[2]!.label).toContain("赤线 50%")
  const colors = stage.cells.map((cell) => {
    if (cell.kind !== "view") throw new Error("少了阶段图")
    const picture = review.job.scenes[cell.scene]!.preview!.textureDataUrl
    return [...decodeRgbaPng(Buffer.from(picture.split(",")[1]!, "base64")).pixels.slice(0, 3)]
  })
  expect(colors[1]).toEqual([16, 31, 41])
  expect(colors[2]).toEqual([48, 35, 41])
  const unchanged = creature({ boss: { ...changingBoss, phases: changingBoss.phases.map(({ model: _, ...phase }) => phase) } })
  expect(looksAt(unchanged)).toBe(false)
  expect(() => lookJob(unchanged, golem)).toThrow("没有可以看的样子")
})

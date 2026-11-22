import { expect, test } from "bun:test"
import { getModuleSchema, type ModuleDocument } from "@minemods/mod-core/workspace"
import { EPIC_MAKING, MAKING_LIMITS } from "@minemods/mod-core/making"
import { HITBOX_SHEET, lookJob } from "../src/main/look-job"
import { fightingGolemDesign, golemAbilities } from "../../mod-core/script/data-gameplay-sample"
import { CAST_SAMPLE_IDS, fireball } from "../../mod-core/script/target-cast-sample"
import { AbilityAssetDocumentSchema, expandedMoves } from "@minemods/mod-core/ability-asset"
import { createMakingLoop } from "../src/main/making-loop"

// 主工程第 16 条：生物看图按档位给张数（史诗档 6 张），碰撞箱、招式范围排在粒子图前面。

type Creature = Extract<ModuleDocument, { kind: "entity" }>
type Model = Extract<ModuleDocument, { kind: "model" }>
const model = (extra: object = {}) => getModuleSchema("model").parse({ kind: "model", ...fightingGolemDesign, ...extra }) as Model
const creature = (extra: Record<string, unknown> = {}) =>
  getModuleSchema("entity").parse({ kind: "entity", name: "石像", description: "", health: 30, speed: 0.2, attack_damage: 0, behavior: "hostile", model_asset_id: "11111111-1111-4111-8111-111111111111", runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null }, abilities: [...golemAbilities], emitters: [{ particle: "flame", every_ticks: 10, count: 4 }], ...extra }) as Creature

test("碰撞箱和招式范围先画，粒子图排在后面；默认档 3 张，画不下的说出来", () => {
  const made = lookJob(creature({ hitbox: { core: { width: 1.1, height: 1 } } }), model())
  const labels = made.job.sheets.map((sheet) => sheet.label)
  expect(labels).toHaveLength(MAKING_LIMITS.sheets)
  expect(labels[0]).toBe(HITBOX_SHEET)
  expect(labels[1]).toStartWith("招式「")
  expect(labels.at(-1)).toStartWith("生物身边的粒子")
  expect(made.notes.join("")).toContain("没有画")
})

test("史诗档的生物一次给 6 张：招式都在前面，粒子跟在后面", () => {
  const made = lookJob(creature(), model({ budget: "epic" }))
  const labels = made.job.sheets.map((sheet) => sheet.label)
  expect(EPIC_MAKING.sheets).toBe(6)
  expect(labels.slice(0, 2).every((label) => label.startsWith("招式「"))).toBe(true)
  expect(labels.slice(2).every((label) => label.startsWith("生物身边的粒子"))).toBe(true)
  expect(labels.length).toBeGreaterThan(MAKING_LIMITS.sheets)
  expect(made.notes.filter((note) => note.includes("没有画"))).toEqual([])
})

// 山𤟤第 17 条：预警用原版彩尘画（paint 不是 mesh）时，看图按彩尘画成一颗颗的点；mesh 画成整块的面，两种看得出不同。
test("看图按 paint 实际画预警：彩尘是点、mesh 是面", () => {
  const index = golemAbilities.findIndex((move) => move.hits.some((hit) => hit.type === "area"))
  const warned = (paint?: "mesh" | "dust") => golemAbilities.map((move, at) => (at === index ? { ...move, hits: move.hits.map((hit) => (hit.type === "area" ? { ...hit, warn: { look: "ring", color: "red", seconds: 0.5, ...(paint ? { paint } : {}) } } : hit)) } : move))
  const cell = (paint?: "mesh" | "dust") => lookJob(creature({ abilities: warned(paint), emitters: undefined }), model()).job.sheets.flatMap((sheet) => sheet.cells).find((value) => value.label.includes("预警出现"))
  for (const paint of [undefined, "dust"] as const) {
    const dust = cell(paint)
    expect(dust?.label).toContain("（原版彩尘）")
    expect(dust?.kind === "hit" && dust.faces).toEqual([])
    expect(dust?.kind === "hit" && dust.particles?.[0]?.points.length).toBeGreaterThan(10)
    expect(dust?.kind === "hit" && dust.caption.join("")).toContain("warn.paint 写 mesh")
  }
  const mesh = cell("mesh")
  expect(mesh?.label).toContain("（网格面）")
  expect(mesh?.kind === "hit" && mesh.faces.length).toBeGreaterThan(0)
  expect(mesh?.kind === "hit" && mesh.particles?.some((group) => group.name === "预警彩尘")).toBeFalsy()
})

// 诸怀第 12 条：只用 shared_abilities 的招也要过看图、画判定图（审查员说材料里没有列出冲撞这一招）。
test("只靠 shared_abilities 出招的生物也进看图；按技能资产展开后，那一招画出判定图", () => {
  const skill = AbilityAssetDocumentSchema.parse(fireball)
  const uses = [{ asset: CAST_SAMPLE_IDS.fireball, id: "fireball", clip: "burst", windup: 0.6, facing: "track", start: { min_distance: 3, max_distance: 16, line_of_sight: true, cooldown: 4, weight: 3 }, stopped_by_hurt: false }]
  const sharing = creature({ abilities: undefined, emitters: undefined, shared_abilities: uses })
  expect(createMakingLoop({ look: async () => ({ ok: true, pictures: [] }) }).reviews(sharing, model())).toBe(true)
  const workspace = { assets: [{ id: CAST_SAMPLE_IDS.fireball, document: skill }] } as never
  const drawn = { ...sharing, abilities: expandedMoves(sharing, workspace) }
  expect(lookJob(drawn, model()).job.sheets.map((sheet) => sheet.label).join("")).toContain(`招式「${skill.name}」`)
})

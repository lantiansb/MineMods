import { expect, test } from "bun:test"
import { getModuleSchema, type ModuleDocument } from "@minemods/mod-core/workspace"
import { BOSS_SHOW_SHEET, lookJob } from "../src/main/look-job"
import { fourEyedDesign, showBoss } from "../../mod-core/script/target-boss-show-sample"

/** Boss 能力 15 in the pictures: per show, a timeline strip and the model at the show's key moments, with the steps' look applied. */

type Creature = Extract<ModuleDocument, { kind: "entity" }>
type Model = Extract<ModuleDocument, { kind: "model" }>
const golem = getModuleSchema("model").parse({ kind: "model", ...fourEyedDesign }) as Model
const creature = (extra: Record<string, unknown> = {}) =>
  getModuleSchema("entity").parse({ kind: "entity", name: "四目魔像", description: "", health: 200, speed: 0.22, attack_damage: 8, behavior: "hostile", model_asset_id: "11111111-1111-4111-8111-111111111111", runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null }, ...extra }) as Creature
type Geometry = { "minecraft:geometry": { bones: { name: string; cubes: { uv: Record<string, { visible?: boolean }> }[] }[] }[] }
const hidden = (geometry: unknown, bone: string) => (geometry as Geometry)["minecraft:geometry"][0]!.bones.find((value) => value.name === bone)!.cubes.flatMap((cube) => Object.values(cube.uv)).every((face) => face.visible === false)

test("each show: a timeline strip, then the model at its key moments with the eyes, the dropped weapons, the glow and the motion of that moment", () => {
  const made = lookJob(creature({ boss: showBoss }), golem)
  const intro = made.job.sheets.find((sheet) => sheet.label === BOSS_SHOW_SHEET("登场"))!
  const death = made.job.sheets.find((sheet) => sheet.label === BOSS_SHOW_SHEET("死亡"))!
  expect(intro.cells[0]!.kind).toBe("flat")
  expect(intro.cells[0]!.label).toContain("登场演出时间轴（横轴 0–4 秒")
  // The wake-up: all four eyes hidden at its start; two of them by 1.5 s… none at its end.
  const scene = (cell: (typeof intro.cells)[number]) => made.job.scenes[(cell as { scene: number }).scene]!
  const eyes = intro.cells.slice(1).map((cell) => ["eye_1", "eye_2", "eye_3", "eye_4"].filter((bone) => hidden(scene(cell).preview!.geometry, bone)).length)
  expect(eyes[0]).toBe(4)
  expect(eyes.at(-1)).toBe(0)
  expect(intro.cells.at(-1)!.label).toContain("自身发光 100%")
  // The death: both weapons gone and kneeling by its end.
  const end = death.cells.at(-1)!
  expect(hidden(scene(end).preview!.geometry, "arm_left") && hidden(scene(end).preview!.geometry, "arm_right")).toBe(true)
  expect(end.kind === "view" && end.animation === "kneel").toBe(true)
  expect(made.notes.join("\n")).toContain("死亡演出按时间走：")
})

test("a boss without steps (and nothing else to draw) has no show sheet: there is nothing to look at", () => {
  const { steps: _intro, ...intro } = showBoss.intro!
  const { steps: _death, ...death } = showBoss.death
  expect(() => lookJob(creature({ boss: { ...showBoss, intro, death } }), golem)).toThrow("没有可以看的样子")
})

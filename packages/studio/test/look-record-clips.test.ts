import { expect, test } from "bun:test"
import { begin, describe, fingerprint, looked, MAKING_LIMITS, MakingRecordSchema } from "@minemods/mod-core/making"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { TIER_CEILING } from "@minemods/studio-ai/budget"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { lookJob, type LookCell } from "../src/main/look-job"

/**
 * A formal look keeps a measured note of every clip the model has, however many its tier allows: an epic Boss of 21 clips (蚩尤, 2026-11-16)
 * had its first look refused because the round's record held 16 at most, and its maker had to merge clips to get past it. What a look draws is
 * bounded by the look's own picture limit; what it measured is kept whole.
 */

const FACES = { north: "#7a5c3a", east: "#7a5c3a", south: "#7a5c3a", west: "#7a5c3a", up: "#9a7c5a", down: "#5a3c1a" }
const cube = (name: string, origin: number[], size: number[]) => ({ name, origin, size, faces: FACES, surface_details: [] })
const NAMES = ["idle", "walk", "run", "hurt", "death", "roar", "slam", "sweep", "charge", "leap", "land", "summon", "rain", "guard", "taunt", "spin", "stomp", "phase_two", "rage", "breath", "throw", "kneel"]

/** A Boss with `count` clips; every clip swings its arms by its own amount. */
const boss = (count: number) => ({
  kind: "model" as const,
  ...ModelDesignSchema.parse({
    name: "蚩尤",
    budget: "epic",
    texture_size: 128,
    bones: [
      { name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [] },
      { name: "body", parent: "root", pivot: [0, 24, 0], rotation: [0, 0, 0], cubes: [cube("trunk", [-6, 12, -3], [12, 14, 6]), cube("legs", [-5, 0, -2], [10, 12, 4])] },
      { name: "head", parent: "body", pivot: [0, 26, 0], rotation: [0, 0, 0], cubes: [cube("skull", [-4, 26, -4], [8, 8, 8])] },
      { name: "arm_l", parent: "body", pivot: [7, 24, 0], rotation: [0, 0, 0], cubes: [cube("arm_l", [6, 12, -2], [3, 12, 4])] },
      { name: "arm_r", parent: "body", pivot: [-7, 24, 0], rotation: [0, 0, 0], cubes: [cube("arm_r", [-9, 12, -2], [3, 12, 4])] },
    ],
    animations: Array.from({ length: count }, (_, index) => ({
      name: NAMES[index] ?? `move_${index}`,
      length: 1 + (index % 3) * 0.5,
      loop: index % 2 === 0,
      channels: (["arm_l", "arm_r"] as const).map((bone) => ({
        bone,
        keyframes: [0, 0.5, 1].map((at, step) => ({ time: at * (1 + (index % 3) * 0.5), rotation: [step === 1 ? (bone === "arm_l" ? -1 : 1) * (40 + index * 3) : 0, 0, 0] })),
      })),
    })),
  }),
})

const sheet = {
  subject: "蚩尤，铜头铁额的史诗 Boss。",
  recognisable: ["青铜的头和额", "两条粗壮的手臂"],
  parts: [
    { name: "body", what: "躯干", shape: "宽厚的石块，约 12×14×6 像素", attaches: "立在两条腿上", surface: "青铜铠甲", moves: "跟着出招晃动", assumed: false },
    { name: "head", what: "头", shape: "方块，约 8×8×8 像素", attaches: "接在躯干顶上", surface: "铜头铁额", moves: "跟着视线转", assumed: false },
  ],
  assumed: [],
  budget: { tier: "epic", reason: "整个模组的终极 Boss，全程被盯着看，招式多", at_once: 1 },
}
const start = () =>
  describe(
    begin(null, { asset_id: "22222222-2222-4222-8222-222222222222", entry: "chiyou_model", kind: "model", request: "做蚩尤", brief: "蚩尤的模型", task_id: "11111111-1111-4111-8111-111111111111", remark: null }),
    sheet,
  )
const animated = (cells: LookCell[]) => cells.flatMap((cell) => (cell.kind === "view" && cell.animation !== undefined ? [cell.animation] : []))

test("an epic Boss of 21 clips: its formal look draws what it was asked within the picture limit, and the round keeps a note of every clip", () => {
  const model = boss(21)
  const record = start()
  const made = lookJob(model as ModuleDocument, null, { animation: "slam" }, record.sheet)
  // Drawn: within the look's limit, and of the clips only the one asked for.
  expect(made.job.sheets.length).toBeLessThanOrEqual(MAKING_LIMITS.sheets)
  expect(new Set(animated(made.job.sheets.flatMap((value) => value.cells)))).toEqual(new Set(["slam"]))
  // Measured: every clip, each in a sentence the maker is told.
  expect(made.motion.map((note) => note.name)).toEqual(model.animations.map((clip) => clip.name))
  // Two sentences a clip, and (第 2 步) one more on how each clip that does not loop is phrased (not a flinch or a death).
  expect(made.facts).toHaveLength(21 * 2 + model.animations.filter((clip) => !clip.loop && clip.name !== "hurt" && clip.name !== "death").length)
  // Kept: the round of the record holds all 21 (this was refused at 16).
  const shown = looked(record, { fingerprint: fingerprint(model), pictures: [{ label: "六个角度", file: "1-a-0.jpg" }], findings: [], motion: made.motion, budget: made.budget })
  expect(shown.rounds[0]!.motion).toHaveLength(21)
  expect(MakingRecordSchema.parse(shown).rounds[0]!.motion!.map((note) => note.name)).toEqual(model.animations.map((clip) => clip.name))
})

test("the round's record holds as many clip notes as any tier lets a model have, and no more", () => {
  const model = boss(TIER_CEILING.animations)
  const record = start()
  const made = lookJob(model as ModuleDocument, null, {}, record.sheet)
  expect(made.motion).toHaveLength(TIER_CEILING.animations)
  const shown = looked(record, { fingerprint: fingerprint(model), pictures: [{ label: "六个角度", file: "1-a-0.jpg" }], findings: [], motion: made.motion })
  expect(shown.rounds[0]!.motion).toHaveLength(TIER_CEILING.animations)
  // One more than a model may have is not a record of a model's look.
  expect(MakingRecordSchema.safeParse({ ...shown, rounds: [{ ...shown.rounds[0]!, motion: [...made.motion, made.motion[0]!] }] }).success).toBe(false)
})

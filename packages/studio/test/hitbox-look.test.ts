import { expect, test } from "bun:test"
import { abilityFault, abilityScope, ABILITY_REVIEW_GUIDE, ABILITY_REVIEWER_INSTRUCTIONS, HITBOX_FAULT_MARK, HITBOX_PICTURE_WORDS, FINDING_LABELS } from "@minemods/mod-core/making"
import { getModuleSchema, type ModuleDocument } from "@minemods/mod-core/workspace"
import { HITBOX_FOLLOW_SHEET, HITBOX_SHEET, lookJob, reviewJob } from "../src/main/look-job"
import { createMakingLoop } from "../src/main/making-loop"
import { fightingGolemDesign, golemAbilities, longCreatureDesign, longCreatureHitbox } from "../../mod-core/script/data-gameplay-sample"

type Creature = Extract<ModuleDocument, { kind: "entity" }>
type Model = Extract<ModuleDocument, { kind: "model" }>
const model = (design: object) => getModuleSchema("model").parse({ kind: "model", ...design }) as Model
const creature = (extra: Record<string, unknown> = {}) =>
  getModuleSchema("entity").parse({ kind: "entity", name: "长脊兽", description: "", health: 30, speed: 0.2, attack_damage: 0, behavior: "passive", model_asset_id: "11111111-1111-4111-8111-111111111111", runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null }, ...extra }) as Creature
const long = model(longCreatureDesign)
const golem = model(fightingGolemDesign)

test("solid parts carry the outline flag and their plain names in the look", () => {
  const parts = longCreatureHitbox.parts.map((part, index) => ({ ...part, ...(index === 0 ? { solid: true } : {}) }))
  const made = lookJob(creature({ hitbox: { ...longCreatureHitbox, parts } }), long)
  const cell = made.job.sheets[0]!.cells[0]!
  if (cell.kind !== "boxes") throw new Error("expected collision boxes")
  expect(cell.boxes.map((box) => box.solid === true)).toEqual([false, true, false, false, false])
  expect(made.job.sheets[0]!.label).toContain("青绿色边线")
  expect(made.notes.join("\n")).toContain("「" + parts[0]!.name + "」")
})

test("the solid core and rail share the solid outline in rest and motion, outside the hit budget", () => {
  const rail = { name: "外栏", forward: 6, left: 0, up: 0, width: 1, height: 2 }
  const body = { ...longCreatureHitbox, core: { ...longCreatureHitbox.core, solid: true }, blockers: [rail] }
  const made = lookJob(creature({ hitbox: body }), long)
  const baseline = lookJob(creature({ hitbox: longCreatureHitbox }), long)
  expect(made.measured).toEqual(baseline.measured)
  for (const cell of made.job.sheets.flatMap(sheet => sheet.cells)) {
    if (cell.kind !== "boxes") continue
    expect(cell.boxes.filter(box => box.solid)).toHaveLength(2)
    expect(cell.boxes[0]?.solid).toBe(true)
    expect(cell.boxes.at(-1)?.solid).toBe(true)
  }
  expect(made.notes.join("")).toContain("「外栏」。这些箱子不接收攻击")
})

test("a creature whose one square box does not fit is looked at: its boxes on its model from above and from the side, with what was measured", () => {
  const made = lookJob(creature(), long)
  expect(made.job.sheets.map((sheet) => sheet.label)).toEqual([HITBOX_SHEET])
  const cells = made.job.sheets[0]!.cells.flatMap((cell) => (cell.kind === "boxes" ? [cell] : []))
  expect(cells.map((cell) => cell.view)).toEqual(["top", "plus_x", "quarter", "front"])
  expect(cells.every((cell) => cell.boxes.length === 1 && cell.boxes[0]!.core && cell.boxes[0]!.faces.length === 6)).toBe(true)
  expect(cells[0]!.caption.join("")).toContain("碰撞箱里有 92% 是空的（事实，不算不合身）")
  expect(cells[1]!.caption[0]).toStartWith(HITBOX_FAULT_MARK)
  // What has to be answered is picked out of the notes the way an ability's faults are.
  expect(made.notes[0]).toBe(HITBOX_PICTURE_WORDS)
  expect(made.measured).toHaveLength(1)
  expect(made.measured![0]).toContain("左右比模型多出 2.31 格")
  expect(made.measured!.every(abilityFault)).toBe(true)
})

test("with boxes along its body nothing is left to answer, and the worst moment of its walk is drawn; a reviewer gets the same sheet first", () => {
  // Its parts name no bone: they stay where they are stated, and the tail's swing in the walk is the worst moment.
  const unboned = { ...longCreatureHitbox, parts: longCreatureHitbox.parts.map(({ bone: _bone, ...part }) => part) }
  const made = lookJob(creature({ hitbox: unboned }), long)
  expect(made.measured).toEqual([])
  expect(made.job.sheets.map((sheet) => sheet.label)).toEqual([HITBOX_SHEET])
  const cells = made.job.sheets[0]!.cells.flatMap((cell) => (cell.kind === "boxes" ? [cell] : []))
  expect(cells.map((cell) => [cell.view, cell.animation ?? null])).toEqual([["top", null], ["plus_x", null], ["quarter", null], ["top", "walk"], ["quarter", "walk"]])
  expect(cells[0]!.boxes.map((box) => box.core)).toEqual([true, false, false, false, false])
  expect(cells[3]!.caption.join("")).toContain("箱子不跟着动作动")
  // 任务二: named by their bones they follow them. Nothing of the walk is worse than standing, and a second picture shows the boxes where the game moves them,
  // three moments of each motion that moves one (this creature fights nobody, so standing and walking only), from a quarter, on the model posed then.
  const following = lookJob(creature({ hitbox: longCreatureHitbox }), long)
  expect(following.measured).toEqual([])
  expect(following.job.sheets.map((sheet) => sheet.label)).toEqual([HITBOX_SHEET, HITBOX_FOLLOW_SHEET])
  expect(following.job.sheets[0]!.cells.map((cell) => (cell.kind === "boxes" ? cell.animation ?? null : "other"))).toEqual([null, null, null, null])
  const moments = following.job.sheets[1]!.cells.flatMap((cell) => (cell.kind === "boxes" ? [cell] : []))
  expect(moments.length % 3).toBe(0)
  expect(moments.length).toBeGreaterThan(0)
  expect(moments.every((cell) => cell.view === "quarter" && (cell.animation === "idle" || cell.animation === "walk") && typeof cell.time === "number")).toBe(true)
  expect(new Set(moments.map((cell) => JSON.stringify(cell.boxes))).size).toBeGreaterThan(1)
  expect(following.notes.join("")).toContain("跟着模型的 tail 动")
  // A core that leaves most of it uncovered is said, and a reason in the document answers it.
  expect(lookJob(creature({ hitbox: { core: longCreatureHitbox.core } }), long).measured?.join("")).toContain("露在所有碰撞箱外面")
  expect(lookJob(creature({ hitbox: { core: longCreatureHitbox.core, justified: [{ what: "out", reason: "只有躯干算数" }] } }), long).measured).toEqual([])
  // With abilities too: the boxes first, then every ability as before.
  const fighter = creature({ behavior: "hostile", attack_damage: 6, abilities: golemAbilities, hitbox: { core: { width: 0.75, height: 1.6875 } } })
  expect(reviewJob(fighter, golem).job.sheets.map((sheet) => sheet.label)).toEqual([HITBOX_SHEET, "招式「重锤」· 出手的那一刻（红色是判定范围）", "招式「晶刺喷射」· 2 次出手（红色是判定范围）"])
  expect(lookJob(fighter, golem, { animation: "slam" }).job.sheets.map((sheet) => sheet.label)).toEqual(["招式「重锤」· 出手的那一刻（红色是判定范围）"])
})

test("which creatures go through the loop: abilities, stated boxes, or one box that does not fit the model; a small one that says nothing does not", () => {
  const making = createMakingLoop({ look: async () => ({ ok: true, pictures: [] }) })
  expect(making.reviews(creature(), golem)).toBe(false)
  expect(making.reviews(creature(), long)).toBe(true)
  expect(making.reviews(creature())).toBe(false)
  expect(making.reviews(creature({ hitbox: longCreatureHitbox }))).toBe(true)
  expect(createMakingLoop({}).reviews(creature(), long)).toBe(false)
  // The reviewer is told what the colours mean and what counts.
  expect(abilityScope("长脊兽", [], { abilities: false, hitbox: true }).judging).toBe("「长脊兽」的碰撞箱合不合身：玩家对着看得见的身体打，打不打得中。只看量出来超过门槛的那几句，不另定标准。")
  expect(abilityScope("长脊兽", []).judging).not.toContain("碰撞箱")
  // What blocks is the measured misfit that is also seen in the picture; the other numbers are facts, and no reviewer sets a threshold of its own.
  expect(ABILITY_REVIEWER_INSTRUCTIONS).toContain(`是不是不合身，只看以「${HITBOX_FAULT_MARK}」开头的句子：那是量出来超过门槛的，图上也看得出来就是${FINDING_LABELS.blocking}`)
  expect(ABILITY_REVIEWER_INSTRUCTIONS).toContain("就不要自己另定一个数")
  expect(ABILITY_REVIEW_GUIDE).toContain(HITBOX_PICTURE_WORDS)
})

// Owner's rule: a legitimate subject always has a legal way out. An aura, a thorn burst, a contact burn or a trap counts its hit the moment it starts (a wind-up of 0 is legal in the schema),
// and that used to block "done" for good, because the creature's maker can change neither the measuring nor the model's motion.
test("an ability fault the creature's own justified answers is no longer measured to be answered: the reason stays in the notes the reviewer reads", () => {
  const aura = { ...golemAbilities[0]!, id: "thorn_aura", name: "荆棘光环", windup: 0, hits: [{ ...golemAbilities[0]!.hits[0]!, at: 0 }] }
  const fighter = (justified?: { what: string; reason: string }[]) => creature({ behavior: "hostile", attack_damage: 6, abilities: [aura], hitbox: { core: { width: 0.75, height: 1.6875 } }, ...(justified ? { justified } : {}) })
  const blocking = (made: ReturnType<typeof lookJob>) => (made.measured ?? []).map((line) => (line.includes("没有蓄力") ? "windup" : line.startsWith("对不上") ? "timing" : "other"))
  // As before: a missing wind-up and a stroke that lands late are both measured, and each says how to answer it.
  const plain = lookJob(fighter(), golem)
  expect(blocking(plain).sort()).toEqual(["timing", "windup"])
  expect(plain.measured!.join("")).toContain('{"what":"thorn_aura:windup","reason":"……"}')
  // Answered, the sentence stays (the reviewer and the person read the reason in it) and is no longer a measured fault.
  const reason = "光环一进范围就判定，本来就不蓄力"
  const answered = lookJob(fighter([{ what: "thorn_aura:windup", reason }]), golem)
  expect(blocking(answered)).toEqual(["timing"])
  expect(answered.notes.join("")).toContain(`一开始就判定，不蓄力（文档的 justified 里写了本来就该这样：${reason}）`)
  const both = lookJob(fighter([{ what: "thorn_aura:windup", reason }, { what: "thorn_aura:timing", reason: "动作随后才挥到，判定一开始就算" }]), golem)
  expect(both.measured).toEqual([])
  expect(both.notes.join("")).toContain("动作随后才挥到，判定一开始就算")
  // The reviewer's packet is built from the same notes (`ability_facts`), so it reads the same sentences.
  expect(reviewJob(fighter([{ what: "thorn_aura:windup", reason }, { what: "thorn_aura:timing", reason: "x" }]), golem).measured).toEqual([])
  // A reason for another ability, or without words, changes nothing.
  expect(blocking(lookJob(fighter([{ what: "other:windup", reason }]), golem)).sort()).toEqual(["timing", "windup"])
})

test("a boss with boxes on its arms still gets its abilities drawn: the boxes give way, and no motion it has is said to be missing", () => {
  // The UI run of 2026-11-15: two arm boxes took two sheets and the boss one, the abilities were given none, and the look said the model lacked the very motions it listed.
  const boss = {
    bar: { color: "purple", style: "notched_10", darken_sky: true },
    intro: { wake_distance: 16, clip: "roar", seconds: 0.8, sound: "entity.iron_golem.attack" },
    phases: [
      { below: 0.66, clip: "wave", seconds: 1, bar_color: "red", speed: 1.15, damage: 1.3, abilities: ["slam"], model: { hide: ["arm_left"] } },
      { below: 0.33, clip: "wave", seconds: 1, bar_color: null, speed: 1.3, damage: 1.6, abilities: [] },
    ],
    death: { seconds: 4, xp_bursts: 6, explosion: true },
    leash: { distance: 48, reset_seconds: 30 },
  }
  const hitbox = {
    core: { width: 0.75, height: 1.6875 },
    parts: [
      { name: "左臂", forward: 0, up: 0.8, left: 0.6, width: 0.4, height: 0.9, bone: "arm_left" },
      { name: "右臂", forward: 0, up: 0.8, left: -0.6, width: 0.4, height: 0.9, bone: "arm_right" },
    ],
  }
  const fighter = creature({ behavior: "hostile", attack_damage: 6, abilities: golemAbilities, hitbox, boss })
  const made = lookJob(fighter, golem)
  const labels = made.job.sheets.map((sheet) => sheet.label)
  expect(labels.length).toBeLessThanOrEqual(3)
  expect(labels.some((label) => label.startsWith("招式「"))).toBe(true)
  expect(labels[0]).toBe(HITBOX_SHEET)
  // What did not fit is said, as everywhere else.
  expect(made.notes.join("")).toContain("这次没有画")
})

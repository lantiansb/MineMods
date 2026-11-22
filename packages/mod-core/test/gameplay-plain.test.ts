import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { reviewAsset } from "../src/acceptance"
import { compilerFindings, floorPassed, plainCheckLines, staticChecks, type GameplayCheck } from "../src/gameplay-check"
import { COMPILE_ELSEWHERE_NOTE, COMPILE_PLAIN, PLAIN_RULES, PLAIN_UNKNOWN, RULE_IDS, plainFinding, plainFindings } from "../src/gameplay-plain"
import { STARTUP_RULES } from "../src/gameplay-scan"
import { GameplayRecordSchema, beginGameplay, checkedGameplay, describeGameplay, gameplayCommitGate, gameplayCommitGatePlain, gameplayUnsatisfied, gameplayUnsatisfiedTechnical, keepGameplay, reviewedGameplay, shownGameplay } from "../src/gameplay-loop"
import { GAMEPLAY_DISCIPLINE, GAMEPLAY_REFUSALS, GAMEPLAY_REVIEWER_INSTRUCTIONS, GAMEPLAY_WRITER_INSTRUCTIONS } from "../src/gameplay-words"
import { gameplaySheet } from "../src/gameplay"
import { MakingRefusal, fingerprint } from "../src/making"
import { PLAIN_FOR_PERSON } from "@minemods/studio-ai/making"
import { identifiersIn, mostlyCode } from "../src/play-words"
import { BAD, BOX_GUARD, IDS, sampleProject } from "./fixtures/gameplay/sample"

/**
 * Round 18: the acceptance card, the failure card and the making floor showed the checks' own words to a person: a class name, a file name, a folder name, and
 * (the round before) a placeholder where a name had been. Each rule has a sentence of its own, every sentence the person is shown is free of code, and the
 * quoted finding stays beside it for 高级 and for the AI that has to fix the code.
 */

const SOURCES = ["gameplay-scan.ts", "gameplay-references.ts", "gameplay-check.ts", "gameplay-compile.ts", "gameplay-already.ts"]
const read = (file: string) => readFile(path.join(import.meta.dir, "..", "src", file), "utf8")

test("every rule a gameplay check can raise has a sentence for the person; the table has no rule that nothing raises", async () => {
  const text = (await Promise.all(SOURCES.map(read))).join("\n")
  // The rules as they are written where the checks raise them: `rule: "x"` on a finding, `add("x", …)` in the startup scan and the references, and the one rule chosen by a condition.
  const raised = new Set([...text.matchAll(/\brule: "([a-z_]+)"|\badd\("([a-z_]+)"|\brule: [\w[\]!. ]*===\s*"[a-z]+"\s*\?\s*"([a-z_]+)"/g)].map((match) => (match[1] ?? match[2] ?? match[3])!))
  for (const id of Object.keys(STARTUP_RULES)) raised.add(id)
  const missing = [...raised].filter((id) => !(id in PLAIN_RULES))
  expect(missing).toEqual([])
  // Tables of rules inside the scan (`{ rule: "files", names: … }`) are found by the same pattern, so a rule in a table counts too.
  for (const known of ["reflection", "files", "network", "hand", "load_reentry", "compile", "unknown_use", "goal_always"]) expect(RULE_IDS).toContain(known)
  const unused = RULE_IDS.filter((id) => !raised.has(id))
  expect(unused).toEqual([])
  // None of the sentences quotes code, and each is a sentence.
  for (const [id, said] of Object.entries(PLAIN_RULES)) {
    expect([id, identifiersIn(said.replace(/（mixin）/, ""))]).toEqual([id, []])
    expect([id, said.endsWith("。")]).toEqual([id, true])
  }
  for (const said of [...Object.values(COMPILE_PLAIN).map((value) => (typeof value === "string" ? value : value("class"))), COMPILE_ELSEWHERE_NOTE, PLAIN_UNKNOWN]) expect(identifiersIn(said)).toEqual([])
})

test("a finding is said by its own plain sentence, else its rule's, else a sentence that guesses nothing; an old record without the field reads the same way", () => {
  expect(plainFinding({ rule: "network" })).toBe(PLAIN_RULES.network)
  expect(plainFinding({ rule: "network", plain: "  自己写的一句。 " })).toBe("自己写的一句。")
  // A rule from a later version, or one that has no sentence: nothing about the code is made up.
  expect(plainFinding({ rule: "rule_from_the_future" })).toBe(PLAIN_UNKNOWN)
  // Several places for one rule are one sentence; the first few kinds are said and the rest are counted.
  const place = (rule: string) => ({ rule })
  expect(plainFindings([place("files"), place("files"), place("network")])).toBe(`${PLAIN_RULES.files}${PLAIN_RULES.network}`)
  expect(plainFindings(["files", "network", "threads", "host", "exit", "native"].map(place))).toEndWith("（还有 2 类问题）")
  expect(plainFindings([])).toBe("")
})

test("round 18's population-cap card: the compiler's 找不到类 SpawnRestriction is a sentence about the code, and the class stays in the quoted line", () => {
  const output = `/tmp/p/generated/check-1/src/main/java/com/minemods/content_legacy_sample/gameplay/box_guard/Cap.java:14: error: cannot find symbol
        SpawnRestriction.register(type);
        ^
  symbol:   class SpawnRestriction
  location: class ProjectContent
1 error`
  const { own } = compilerFindings(output, "legacy_sample", "box_guard")
  expect(own).toHaveLength(1)
  const found = own[0]!
  // What the AI that fixes the code is told still names the class and the file.
  expect(found.message).toContain("找不到类 SpawnRestriction（在 class ProjectContent 里）")
  // What the person is told does not.
  expect(found.plain).toBe(COMPILE_PLAIN.symbol("class"))
  expect(found.plain).not.toMatch(/SpawnRestriction|ProjectContent|找不到类|Cap\.java/)
  const check: GameplayCheck = { bounds: [], references: [], compile: { ok: false, findings: own, compiler: "javac", note: null } }
  const lines = plainCheckLines(check)
  expect(lines).toHaveLength(1)
  expect(lines[0]).toContain(COMPILE_PLAIN.symbol("class"))
  expect(identifiersIn(lines[0]!)).toEqual([])
  expect(lines[0]).not.toMatch(/SpawnRestriction|ProjectContent|Cap\.java|generated/)
  // Every way the compiler can fail has a sentence with no code in it, and a message nobody has a sentence for gets the generic one.
  expect(compilerFindings("/x/com/minemods/content_legacy_sample/gameplay/box_guard/A.java:3: error: something new the table does not know", "legacy_sample", "box_guard").own[0]!.plain).toBe(COMPILE_PLAIN.other)
})

test("the acceptance card's gameplay defects carry a sentence for the person next to the quoted one", () => {
  const project = sampleProject()
  const judged = (document: typeof BOX_GUARD, compiled?: GameplayCheck["compile"]) => reviewAsset(project, { id: IDS.box_guard, module: "gameplay", document, dependencies: document.uses }, { candidate: true, ...(compiled === undefined ? {} : { compiled }) })
  const socket = judged(BAD.opens_socket).findings[0]!
  // The retest's 近距鸣叫 card: the quoted message names the class, the file and the folder; the card's plain line does not.
  expect(socket.message).toContain("java.net.Socket")
  expect(socket.plain).toBe(`代码越界了（1 处）：${PLAIN_RULES.network}`)
  expect(identifiersIn(socket.plain!)).toEqual([])
  const missing = judged(BAD.missing_item).findings[0]!
  expect(missing.plain).toContain("引用对不上")
  expect(identifiersIn(missing.plain!)).toEqual([])
  const output = "/tmp/p/generated/check-1/src/main/java/com/minemods/content_legacy_sample/gameplay/box_guard/Alarm.java:12: error: package net.minecraft.world.level does not exist\n1 error"
  const compile = judged(BOX_GUARD, { ok: false, findings: compilerFindings(output, "legacy_sample", "box_guard").own, compiler: "javac", note: null }).findings[0]!
  expect(compile.message).toContain("net.minecraft.world.level")
  expect(compile.plain).toBe(`代码编译不过：${COMPILE_PLAIN.package}`)
  // A defect the machine raised without a plain sentence (an older record, a gate of another kind) still has a message to show.
  expect(typeof compile.message).toBe("string")
})

test("a refusal of the loop has one voice for the AI that fixes the code and one for the person, and the person's names no code", () => {
  const begun = beginGameplay(null, { asset_id: IDS.box_guard, entry: "guard", request: "一只守着秘匣的生物", brief: "守匣", task_id: "a0000000-0000-4000-8000-000000000001", remark: null })
  const described = describeGameplay(begun, gameplaySheet(BOX_GUARD))
  const socket = staticChecks(sampleProject(), BAD.opens_socket, null)
  const failed = checkedGameplay(described, BAD.opens_socket, { ...socket, compile: null })
  expect(floorPassed({ ...socket, compile: null })).toBe(false)
  try {
    reviewedGameplay(failed, { passed: true, findings: [], independent: true })
    throw new Error("not refused")
  } catch (error) {
    expect(error).toBeInstanceOf(MakingRefusal)
    const refusal = error as MakingRefusal
    // The AI is told the file, the line and the class.
    expect(refusal.message).toContain("Alarm.java 第 36 行")
    expect(refusal.message).toContain("java.net.Socket")
    // The person is told what was wrong, once, with no name of code.
    expect(refusal.plain).toBe(GAMEPLAY_REFUSALS.floor_plain(plainCheckLines({ ...socket, compile: null })))
    expect(refusal.plain).toContain(PLAIN_RULES.network)
    expect(refusal.plain).not.toMatch(/Alarm|Socket|java\./)
    expect(identifiersIn(refusal.plain!)).toEqual([])
  }
})

test("the technical detail behind a review or a stop is kept beside the plain words, read back from the record, and absent records still read", () => {
  const begun = beginGameplay(null, { asset_id: IDS.box_guard, entry: "guard", request: "一只守着秘匣的生物", brief: "守匣", task_id: "a0000000-0000-4000-8000-000000000001", remark: null })
  const clean: GameplayCheck = { bounds: [], references: [], compile: { ok: true, findings: [], compiler: "javac", note: null } }
  const passed = checkedGameplay(describeGameplay(begun, gameplaySheet(BOX_GUARD)), BOX_GUARD, clean)
  const reviewed = reviewedGameplay(passed, { passed: false, findings: ["说明里的冷却，代码没有做"], technical: ["HabitAlertGoal 在 Main.java 里注册，generated 里没有冷却字段"], independent: true })
  expect(reviewed.review).toMatchObject({ passed: false, findings: ["说明里的冷却，代码没有做"], technical: ["HabitAlertGoal 在 Main.java 里注册，generated 里没有冷却字段"] })
  // What is kept for the person carries the plain line; what is behind it is a separate list and reaches the record whole.
  const said = gameplayUnsatisfied(reviewed, "三版都没有做到")
  expect(said.join("\n")).toContain("说明里的冷却，代码没有做")
  expect(said.join("\n")).not.toMatch(/HabitAlertGoal|Main\.java|generated/)
  const technical = gameplayUnsatisfiedTechnical(reviewed, "Main.java 第 12 行 TypeError")
  expect(technical).toEqual(["Main.java 第 12 行 TypeError", "HabitAlertGoal 在 Main.java 里注册，generated 里没有冷却字段"])
  const kept = keepGameplay(reviewed, said, technical)
  expect(kept).toMatchObject({ outcome: "kept_unsatisfied", kept_technical: technical })
  expect(shownGameplay(kept)).toMatchObject({ kept_reason: said, kept_technical: technical })
  expect(GameplayRecordSchema.parse(JSON.parse(JSON.stringify(kept)))).toEqual(kept)
  // Records written before this field existed have no technical list and are read as they were.
  const { kept_technical: _later, ...older } = JSON.parse(JSON.stringify(kept))
  expect(GameplayRecordSchema.parse(older).kept_technical).toBeUndefined()
  expect(shownGameplay(GameplayRecordSchema.parse(older))).not.toHaveProperty("kept_technical")
  expect(keepGameplay(reviewed, said)).not.toHaveProperty("kept_technical")
})

test("what the AI is told: write for the person in plain words and put the code in a separate field, without naming a rule of the checks", () => {
  // The description is written for a player, the reviewer's lines are laid out for the person, and the writer is handed the reviewer's technical notes back.
  expect(GAMEPLAY_DISCIPLINE).toContain("不放代码")
  expect(GAMEPLAY_REVIEWER_INSTRUCTIONS).toContain(PLAIN_FOR_PERSON)
  expect(GAMEPLAY_REVIEWER_INSTRUCTIONS).toContain("technical")
  expect(GAMEPLAY_WRITER_INSTRUCTIONS).toContain("reviewer_technical")
  for (const words of [GAMEPLAY_DISCIPLINE, GAMEPLAY_WRITER_INSTRUCTIONS, GAMEPLAY_REVIEWER_INSTRUCTIONS]) {
    // Not one rule id of the checks is in what an AI is told (the sentence about the hand names the callbacks and the parameter, which are the game's words, not a rule).
    for (const id of RULE_IDS.filter((value) => value.includes("_"))) expect([id, words.includes(id)]).toEqual([id, false])
  }
})

test("which of an AI's sentences are code with a few words around them, with the real strings of the report", () => {
  expect(mostlyCode("识别 HabitAlertGoal 在 Main.java 里注册，generated 里写了")).toBe(false)
  expect(mostlyCode("找不到类 SpawnRestriction（在 ProjectContent 里）")).toBe(false)
  expect(mostlyCode("TypeError at model-look.ts colorDistance/marks")).toBe(true)
})

test("the hand-in door tells the person what stopped the hand-in without the tool names or the quoted code, and the AI keeps its own sentence", () => {
  const begun = beginGameplay(null, { asset_id: IDS.box_guard, entry: "guard", request: "一只守着秘匣的生物", brief: "守匣", task_id: "a0000000-0000-4000-8000-000000000001", remark: null })
  const described = describeGameplay(begun, gameplaySheet(BOX_GUARD))
  const version = fingerprint(BAD.opens_socket)
  const failed = checkedGameplay(described, BAD.opens_socket, { ...staticChecks(sampleProject(), BAD.opens_socket, null), compile: null })
  // Failed the code checks: the AI is told the file, the line and the class; the person is told what is wrong.
  expect(gameplayCommitGate(failed, version)).toContain("java.net.Socket")
  const plain = gameplayCommitGatePlain(failed, version)!
  expect(plain).toContain(PLAIN_RULES.network)
  expect(plain).not.toMatch(/Alarm|Socket|java\./)
  // The other refusals are the same facts without the tool names.
  expect(gameplayCommitGate(described, fingerprint(BOX_GUARD))).toBe(GAMEPLAY_REFUSALS.no_check)
  expect(gameplayCommitGatePlain(described, fingerprint(BOX_GUARD))).toBe("这一版还没有检查过。")
  expect(gameplayCommitGatePlain(null, version)).toBe("还没有玩法说明。")
  // An open gate has no refusal in either voice.
  const clean: GameplayCheck = { bounds: [], references: [], compile: { ok: true, findings: [], compiler: "javac", note: null } }
  const reviewed = reviewedGameplay(checkedGameplay(described, BOX_GUARD, clean), { passed: true, findings: [], independent: true })
  expect(gameplayCommitGate(reviewed, fingerprint(BOX_GUARD))).toBeNull()
  expect(gameplayCommitGatePlain(reviewed, fingerprint(BOX_GUARD))).toBeNull()
})

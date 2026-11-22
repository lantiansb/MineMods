import { expect, test } from "bun:test"
import type { GameplayDocument } from "../src/gameplay"
import { GAMEPLAY_API_WORDS, staticChecks } from "../src/gameplay-check"
import { PLAIN_RULES, plainFinding } from "../src/gameplay-plain"
import { GAMEPLAY_DISCIPLINE, GAMEPLAY_INSTRUCTIONS, GAMEPLAY_REVIEWER_INSTRUCTIONS, GAMEPLAY_SHEET_INSTRUCTIONS } from "../src/gameplay-words"
import type { Project } from "../src/project"
import { sampleProject } from "./fixtures/gameplay/sample"

/**
 * broad23: a sword froze vanilla zombies and not the project's own boss. The code asked "is this an enemy" with the class `Monster` (Yarn's `HostileEntity`),
 * which a creature of the project is not (its class is the baby's); the game's marker for an enemy is the interface `Enemy` (Yarn's `Monster`), which both carry.
 */

const ROOT = "com.minemods.content_legacy_sample.gameplay"
const sourceOf = (body: string) => `package ${ROOT}.frost;\n\nimport ${ROOT}.api.GameplayEntry;\nimport net.minecraft.world.entity.LivingEntity;\nimport net.minecraft.world.entity.monster.Enemy;\nimport net.minecraft.world.entity.monster.Monster;\n\npublic final class Main implements GameplayEntry {\n    @Override public void onInitialize() {\n${body}\n    }\n}\n`
const document = (body: string): GameplayDocument => ({
  kind: "gameplay",
  slug: "frost",
  name: "霜角剑",
  summary: "打中敌人冻住一秒。",
  behaviours: [{ when: "用剑打中敌人", does: "敌人停住一秒", shows: "看得见它停下" }],
  not_doing: [],
  uses: [],
  sources: [{ path: "Main.java", content: sourceOf(body) }],
  data: [],
  lang: { zh_cn: {}, en_us: {} },
})
const withCreature = (kind: "hostile" | "follow" | "passive"): Project => {
  const project = sampleProject()
  return { ...project, entities: project.entities.map((entity) => ({ ...entity, behavior: kind })) }
}
const rules = (project: Project, body: string) => (staticChecks(project, document(body), null).advice ?? []).map((found) => found.rule)

test("code that tells enemies apart by the Monster class is told it misses this project's own hostile creatures, in every way of writing it", () => {
  const ways = [
    "        net.fabricmc.fabric.api.event.player.AttackEntityCallback.EVENT.register((p, w, h, e, hit) -> { if (e instanceof Monster) {} return net.minecraft.world.InteractionResult.PASS; });",
    "        Object x = null; boolean b = x instanceof net.minecraft.world.entity.monster.Monster;",
    "        var near = world.getEntitiesOfClass(Monster.class, box, e -> true);",
    "        java.util.List<Monster> near = null;",
    "        var type = net.minecraft.world.entity.monster.Monster\n            .class;",
  ]
  for (const way of ways) expect(rules(withCreature("hostile"), way), way).toEqual(["hostile_missed"])
  const found = staticChecks(withCreature("hostile"), document(ways[0]!), null).advice![0]!
  // It stands in the version's advice (not a refusal), names the file and line, and tells what to write instead.
  expect(staticChecks(withCreature("hostile"), document(ways[0]!), null)).toMatchObject({ bounds: [], references: [] })
  expect(found).toMatchObject({ file: "Main.java", line: 10 })
  expect(found.message).toContain("会被漏掉")
  expect(found.fix).toContain("instanceof Enemy")
  // For the person: one sentence, no name of code in it.
  expect(plainFinding(found)).toBe(PLAIN_RULES.hostile_missed)
  expect(PLAIN_RULES.hostile_missed).not.toMatch(/Hostile|Monster|instanceof|Entity/)
})

test("it says nothing when the code asks by Enemy, when only the game's static helpers or imports are used, or when the project has no hostile creature", () => {
  expect(rules(withCreature("hostile"), "        Object x = null; boolean b = x instanceof Enemy;")).toEqual([])
  expect(rules(withCreature("hostile"), "        boolean dark = Monster.isDarkEnoughToSpawn(null, null, null); // instanceof Monster\n        String s = \"x instanceof Monster\";")).toEqual([])
  for (const kind of ["follow", "passive"] as const) expect(rules(withCreature(kind), "        Object x = null; boolean b = x instanceof Monster;"), kind).toEqual([])
})

test("said once for a file however many times it is written, so a repeat does not bury the rest", () => {
  const body = "        Object x = null; boolean a = x instanceof Monster; boolean b = x instanceof Monster;\n        boolean c = x instanceof Monster;"
  expect(rules(withCreature("hostile"), body)).toEqual(["hostile_missed"])
})

test("the writer is told the one way to ask for an enemy, in one sentence that covers the project's own creatures too", () => {
  const told = GAMEPLAY_API_WORDS.filter((line) => line.includes("instanceof Enemy"))
  expect(told).toHaveLength(1)
  expect(told[0]).toContain("net.minecraft.world.entity.monster.Enemy")
  expect(told[0]).toContain("这个工程里的敌对生物")
  expect(told[0]).toContain("不要用 Monster 类")
  expect(GAMEPLAY_INSTRUCTIONS).toContain(told[0]!)
  // Said nowhere else in the words as a way to tell enemies: the old advice is not left beside the new, nor Yarn's name of the class.
  expect(GAMEPLAY_API_WORDS.filter((line) => line.includes("Monster"))).toEqual(told)
  expect(GAMEPLAY_API_WORDS.join("")).not.toContain("HostileEntity")
})

test("the description is told not to add limits the person did not ask for, and the review counts one that was added as a fault to correct", () => {
  const rule = "不给人没提的东西加限制、排除或条件"
  for (const words of [GAMEPLAY_DISCIPLINE, GAMEPLAY_SHEET_INSTRUCTIONS, GAMEPLAY_INSTRUCTIONS]) {
    expect(words).toContain(rule)
    // What the person did not say is decided the widest, usual way; a limit added is a breach.
    expect(words).toContain("按最常见、最宽的做法定，加了限制就算违规")
  }
  // One sentence, not two beside each other: the older "only fix the numbers" sentence is the one that carries it.
  expect(GAMEPLAY_DISCIPLINE.split(rule)).toHaveLength(2)
  expect(GAMEPLAY_DISCIPLINE).toContain("人没说清楚的地方，只把数字定下来")
  // The review has a kind of its own for it, listed with the others that must be corrected, and it says it is the description to change.
  expect(GAMEPLAY_REVIEWER_INSTRUCTIONS).toContain("④说明给行为加了 request 里没有的限制、排除或条件")
  expect(GAMEPLAY_REVIEWER_INSTRUCTIONS).toContain("要改的是说明")
  expect(GAMEPLAY_REVIEWER_INSTRUCTIONS.indexOf("④说明给行为加了")).toBeLessThan(GAMEPLAY_REVIEWER_INSTRUCTIONS.indexOf("代码里有、说明里没提的行为"))
})

test("the reviewer's instructions are plain sentences all the way through: no part of them is lost to a stray operator", () => {
  expect(GAMEPLAY_REVIEWER_INSTRUCTIONS).not.toContain("NaN")
  expect(GAMEPLAY_REVIEWER_INSTRUCTIONS).toContain("代码里有、说明里没提的行为")
})

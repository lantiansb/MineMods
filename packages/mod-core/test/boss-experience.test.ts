import { expect, test } from "bun:test"
import { CREATURE_LIFE_FIELDS, CREATURE_LIFE_LIMITS, creatureDocumentIssues } from "../src/entity-runtime"

/** epic game1: a boss meant to give 300 experience could only say 100, and the case wrote a gameplay rule for the rest. */

const boss = { bar: "red" } as never
const issues = (experience: number, nullBoss: boolean) => creatureDocumentIssues({ behavior: "hostile", attack_damage: 4, experience, ...(nullBoss ? { boss: null } : {}) }).map((issue) => issue.message)

test("an ordinary creature gives at most 100 experience; a boss up to the ender dragon's 12000", () => {
  expect(CREATURE_LIFE_FIELDS.experience.safeParse(CREATURE_LIFE_LIMITS.boss_experience).success).toBe(true)
  expect(CREATURE_LIFE_FIELDS.experience.safeParse(CREATURE_LIFE_LIMITS.boss_experience + 1).success).toBe(false)
  expect(issues(100, false)).toEqual([])
  expect(issues(300, false).join("")).toContain("写了 Boss（boss）的生物才能给更多")
  // boss: null is no boss.
  expect(issues(300, true).join("")).toContain("最多 100")
})

test("a boss that gives 300 is taken as it is", async () => {
  const { experienceDocumentIssues } = await import("../src/entity-runtime")
  expect(experienceDocumentIssues({ experience: 300, boss })).toEqual([])
  expect(experienceDocumentIssues({ experience: null, boss: null })).toEqual([])
})

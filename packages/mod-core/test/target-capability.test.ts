import { expect, test } from "bun:test"
import { BlueprintSchema, validateBlueprint } from "../src/blueprint"
import { blueprintPlannerInstructions, ideaInstructions } from "../src/blueprint-planner"
import { KIND_GAPS } from "../src/platform/kind-gaps"
import { DEFAULT_TARGET, TargetIdSchema } from "../src/target/ids"
import { ASSET_KINDS, kindCapability, ModuleKindSchema, savedStatus } from "../src/workspace-modules"

/**
 * Whether a kind is made into the game is one answer for every target (Fable's acceptance, 2026-11-15: a Forge or
 * NeoForge project refused a plain boss blueprint because the per-target table had only Fabric's column filled in).
 */

const TARGETS = TargetIdSchema.options

/** The plainest boss blueprint: a model, its texture, the creature (Fable's `repro_blueprint.ts`). */
const style = { palette: ["#335533", "#88aa66"], shape: "方正", naming: "中文名加英文标识", world: "黑石祭坛" }
const entry = (key: string, kind: string, extra: Record<string, unknown> = {}) => ({ key, kind, title: `${key} 标题`, brief: `${key} 说明`, owner: null, needs: [], out_of_scope: null, asset_id: null, ...extra })
const boss = {
  request: "做一只 Boss",
  style,
  questions: [],
  revision: 1,
  state: "draft",
  entries: [entry("boss_model", "model", { owner: "boss" }), entry("boss_tex", "texture", { owner: "boss", needs: ["boss_model"] }), entry("boss", "entity", { needs: ["boss_model", "boss_tex"] })],
}

test("a plain boss blueprint (model, texture, creature) is taken on every target", () => {
  for (const target of TARGETS) expect(() => validateBlueprint(BlueprintSchema.parse(boss), target)).not.toThrow()
})

test("the planner and the idea brief tell every target the same kinds, made into the game or not", () => {
  // Only the line naming the target differs.
  const named = (text: string, target: string) => text.replaceAll(target, "<target>")
  for (const target of TARGETS) {
    expect(named(blueprintPlannerInstructions(target), target)).toBe(named(blueprintPlannerInstructions(DEFAULT_TARGET), DEFAULT_TARGET))
    expect(named(ideaInstructions(target), target)).toBe(named(ideaInstructions(DEFAULT_TARGET), DEFAULT_TARGET))
  }
})

test("every kind is made into the game (and saved as such) on every target as it is on the default one", () => {
  for (const target of TARGETS)
    for (const kind of ModuleKindSchema.options) {
      expect(kindCapability(kind, target)).toBe(kindCapability(kind, DEFAULT_TARGET))
      expect(savedStatus(kind, target)).toBe(savedStatus(kind, DEFAULT_TARGET))
    }
})

test("a target's gap names a target and a kind Studio knows, and says why; there is none today", () => {
  for (const [target, gaps] of Object.entries(KIND_GAPS)) {
    expect(TARGETS as readonly string[]).toContain(target)
    for (const [kind, reason] of Object.entries(gaps ?? {})) {
      expect(ASSET_KINDS.map((value) => value.id) as readonly string[]).toContain(kind)
      expect(reason?.trim().length).toBeGreaterThan(0)
    }
  }
  // Everything is ported (platform/ported.ts lists no group): no target has a gap.
  expect(Object.values(KIND_GAPS).every((gaps) => !gaps || Object.keys(gaps).length === 0)).toBe(true)
})

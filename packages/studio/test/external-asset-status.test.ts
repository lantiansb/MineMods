import { expect, test } from "bun:test"
import type { Project } from "@minemods/mod-core/project"
import { externalAssetStatus } from "../src/main/external-asset-status"

const BOUND = "11111111-1111-4111-8111-111111111111"
const USED = "22222222-2222-4222-8222-222222222222"
const LOOSE = "33333333-3333-4333-8333-333333333333"
const SOUND = "44444444-4444-4444-8444-444444444444"

/** Only what the reading looks at: every skill is stored as `design`, whatever uses it. */
const project = (assets: unknown[], entities: unknown[] = []) =>
  ({ blocks: [], items: [], recipes: [], logic: [], entities, workspace: { assets } }) as unknown as Project
const skill = (id: string, bindings: unknown[]) => ({ id, module: "ability", status: "design", document: { kind: "ability", bindings } })

test("外部 AI 读到的技能状态：绑了东西或被生物引用的是 ready，没人用的是 design；别的种类照原样", () => {
  const sound = { id: SOUND, module: "sound", status: "ready", document: { kind: "sound" } }
  const status = externalAssetStatus(
    project([skill(BOUND, [{ type: "item", item: "wand", use: "hold" }]), skill(USED, []), skill(LOOSE, []), sound], [{ id: "creature_guard", shared_abilities: [{ asset: USED }] }]),
  )
  expect(status({ id: BOUND, module: "ability", status: "design" })).toBe("ready")
  expect(status({ id: USED, module: "ability", status: "design" })).toBe("ready")
  expect(status({ id: LOOSE, module: "ability", status: "design" })).toBe("design")
  expect(status({ id: SOUND, module: "sound", status: "ready" })).toBe("ready")
})

test("没有技能的工程：每样东西的状态一个字不动", () => {
  const status = externalAssetStatus(project([{ id: SOUND, module: "sound", status: "design", document: { kind: "sound" } }]))
  expect(status({ id: SOUND, module: "sound", status: "design" })).toBe("design")
})

import { expect, test } from "bun:test"
import { check, setAt, wordAt } from "../src/renderer/features/asset-edit-form"
import { adopt, memoryOf, switchMemory, switchedOn } from "../src/renderer/features/asset-edit-memory"
import { settle, type Loose } from "../src/renderer/features/asset-edit-words"

// The creature of broad19: plains, bright, weight 8, at most 2 within 48 blocks.
const SETTINGS = { biomes: ["minecraft:plains"], light: "bright", weight: 8, min: 1, max: 2, cap: { count: 2, radius: 48 } }
const cow = (spawn: Loose | null): Loose => ({ kind: "entity", name: "月牛", description: "", health: 10, speed: 0.2, attack_damage: 0, behavior: "passive", model_asset_id: "7d4c4d0e-6f0a-4d53-9d55-0b1a5b0f8a11", runtime: { spawn, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null } })
// What the form does on a change: set the place, then settle the combination.
const edit = (document: Loose, key: string, value: unknown) => settle("entity", setAt(document, key, value))
const spawnOf = (document: Loose) => (document.runtime as Loose).spawn

test("自然生成关掉、保存、再打开：关掉之前的设置原样回来，不是默认值", () => {
  const memory = switchMemory()
  const fresh = wordAt("entity", "runtime.spawn")!.word.fresh
  let draft = cow(structuredClone(SETTINGS))
  // Off: the form keeps what was set and writes the off value, which is what is saved.
  memory.keep("runtime.spawn", spawnOf(draft))
  draft = edit(draft, "runtime.spawn", null)
  expect(spawnOf(draft)).toBeNull()
  // A save replaces the draft with the stored document, which has no spawn: the memory is not part of either, so it is still there.
  draft = structuredClone(draft)
  const back = switchedOn(memory, "runtime.spawn", fresh)
  expect(back.restored).toBe(true)
  draft = edit(draft, "runtime.spawn", back.value)
  expect(spawnOf(draft)).toEqual(SETTINGS)
  expect(check("entity", draft)).toEqual([])
  // Never on in this window: the starting settings, and it says they are not restored.
  const first = switchedOn(switchMemory(), "runtime.spawn", fresh)
  expect(first).toEqual({ value: { biomes: [], tags: ["is_overworld"], weight: 10, min: 1, max: 2 }, restored: false })
})

test("一处最多几只自己的开关也记得住，和整个自然生成各记各的", () => {
  const memory = switchMemory()
  let draft = cow(structuredClone(SETTINGS))
  memory.keep("runtime.spawn.cap", { count: 5, radius: 30 })
  draft = edit(draft, "runtime.spawn.cap", undefined)
  expect((spawnOf(draft) as Loose).cap).toBeUndefined()
  draft = edit(draft, "runtime.spawn.cap", switchedOn(memory, "runtime.spawn.cap", wordAt("entity", "runtime.spawn.cap")!.word.fresh).value)
  expect((spawnOf(draft) as Loose).cap).toEqual({ count: 5, radius: 30 })
  // The whole switch keeps the cap inside what it remembers.
  memory.keep("runtime.spawn", spawnOf(draft))
  expect((memory.recall("runtime.spawn") as Loose).cap).toEqual({ count: 5, radius: 30 })
})

test("记住的是一份拷贝，改了它不会动表格里的东西；关着的、没有值的开关什么都不记", () => {
  const memory = switchMemory()
  const live = structuredClone(SETTINGS)
  memory.keep("runtime.spawn", live)
  live.weight = 99
  const first = memory.recall("runtime.spawn") as Loose
  expect(first.weight).toBe(8)
  first.weight = 1
  expect((memory.recall("runtime.spawn") as Loose).weight).toBe(8)
  // Turning off a switch that was already off must not erase what the last time it was on left.
  memory.keep("runtime.spawn", null)
  memory.keep("runtime.spawn", undefined)
  expect((memory.recall("runtime.spawn") as Loose).weight).toBe(8)
  expect(memory.recall("other")).toBeUndefined()
})

test("同一样东西回到卡片上还是同一份记忆；新做的东西存下来以后记忆跟到它的 id 下面", () => {
  const id = "00000000-0000-4000-8000-0000000000a1"
  const memory = memoryOf(id)
  memory.keep("runtime.spawn", SETTINGS)
  expect(memoryOf(id)).toBe(memory)
  expect(memoryOf("00000000-0000-4000-8000-0000000000a2")).not.toBe(memory)
  // A thing with no id yet has a memory of its own, and it is filed under the id the save gives it.
  const draft = memoryOf(null)
  draft.keep("runtime.spawn", SETTINGS)
  expect(memoryOf(null)).not.toBe(draft)
  adopt("00000000-0000-4000-8000-0000000000a3", draft)
  expect((memoryOf("00000000-0000-4000-8000-0000000000a3").recall("runtime.spawn") as Loose).weight).toBe(8)
})

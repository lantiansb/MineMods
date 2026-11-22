import { expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { RoutePlanSchema, validateRoutePlan } from "../src/project-runs"

const task = { key: "moon_block", module: "block" as const, title: "月石", prompt: "制作发光月石", source: "发光月石", dependencies: [], target_id: null }
const input = { prompt: "制作发光月石和它的配方", assets: [] }

test("routing accepts explicit modules with valid acyclic dependencies", () => {
  const plan = RoutePlanSchema.parse({ summary: "方块与配方", questions: [], tasks: [task, { ...task, key: "moon_recipe", module: "recipe", source: "配方", dependencies: [task.key] }] })
  expect(validateRoutePlan(plan, input).tasks.map(value => value.module)).toEqual(["block", "recipe"])
})

test("routing refuses invented requirements, foreign assets and escaped module scope", () => {
  expect(() => validateRoutePlan({ summary: "bad", questions: [], tasks: [{ ...task, source: "生成维度" }] }, input)).toThrow("原始需求")
  expect(() => validateRoutePlan({ summary: "bad", questions: [], tasks: [{ ...task, target_id: randomUUID() }] }, input)).toThrow("不存在")
  expect(() => validateRoutePlan({ summary: "bad", questions: [], tasks: [task] }, { ...input, module: "recipe" })).toThrow("当前模块")
})

test("routing refuses duplicate writers, cycles and missing dependencies", () => {
  const id = randomUUID()
  expect(() => validateRoutePlan({ summary: "bad", questions: [], tasks: [{ ...task, target_id: id }, { ...task, key: "second", target_id: id }] }, { ...input, assets: [{ id, module: "block" }] })).toThrow("多个并行")
  expect(() => validateRoutePlan({ summary: "bad", questions: [], tasks: [{ ...task, dependencies: ["missing"] }] }, input)).toThrow("无效依赖")
  expect(() => validateRoutePlan({ summary: "bad", questions: [], tasks: [{ ...task, dependencies: ["second"] }, { ...task, key: "second", dependencies: [task.key] }] }, input)).toThrow("循环")
})

test("ambiguous instructions can stop for clarification instead of inventing a task", () => {
  expect(validateRoutePlan({ summary: "需要确定修改对象", tasks: [], questions: ["要修改哪个生物？"] }, { prompt: "把它做大", assets: [] }).questions).toHaveLength(1)
  expect(() => validateRoutePlan({ summary: "empty", tasks: [], questions: [] }, input)).toThrow()
})

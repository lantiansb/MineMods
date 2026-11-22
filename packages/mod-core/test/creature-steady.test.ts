import { expect, test } from "bun:test"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { quadrupedFixture } from "../../studio-ai/test/quadruped-fixture"
import { compileEntity } from "../src/fabric/entity"
import { STEADY_INSTRUCTIONS, resolveSteady, SteadySchema, steadyDocumentIssues } from "../src/creature-steady"

const beast = { modId: "beast_mod", packageName: "com.minemods.content_beast_mod", id: "creature", name: "四足兽", health: 30, speed: 0.25, attack_damage: 3, behavior: "passive", model: ModelDesignSchema.parse(quadrupedFixture()) }

test("稳重不写或写 null 时生物类和渲染器逐字节相同", () => {
  expect(STEADY_INSTRUCTIONS).toContain("写 steady:null 就关掉稳重。")
  const before = compileEntity(beast as never)
  expect(compileEntity({ ...beast, steady: null } as never)).toEqual(before)
  const renderer = String(Object.entries(before).find(([name]) => name.endsWith("StudioCreatureRenderer.java"))![1])
  expect(new Bun.CryptoHasher("sha256").update(renderer).digest("hex")).toBe("21afcf8fd6371ae5f0a9a692fd84226dbda5f61a1bbf38b6cb9ac944573373ae")
})

test("按碰撞箱高度取档，单个调整保留同档其他值", () => {
  expect([1.99, 2, 4, 7].map(height => resolveSteady({ preset: "auto" }, height)?.body_turn)).toEqual([undefined, 180, 90, 60])
  expect(resolveSteady({ preset: "huge", head: { yaw: 0 } }, 1)).toMatchObject({ head: { turn: 150, yaw: 0 }, turn_after: 0 })
  expect(STEADY_INSTRUCTIONS).toContain("body_turn 写 0 表示身体只在出招时转")
  expect(STEADY_INSTRUCTIONS).toContain("其余写 1–1200，表示平时在地面每秒转多少度。")
  expect(SteadySchema.safeParse({ head: { turn: 8 } }).success).toBe(false)
  expect(steadyDocumentIssues({ behavior: "passive", steady: { focus: { hold: 1 } } })).toHaveLength(3)
})

test("小体型按体型设置沿用原来的类，点名预设后才安装控制器", () => {
  const original = compileEntity(beast as never)
  expect(compileEntity({ ...beast, steady: { preset: "auto" } } as never)).toEqual(original)
  const files = compileEntity({ ...beast, steady: { preset: "large", idle_look: "none" } } as never)
  const source = String(Object.entries(files).find(([key]) => key.endsWith("/StudioCreature.java"))![1])
  expect(source).toContain("moveControl = new SteadyMove()")
  expect(source).not.toContain("new LookAtPlayerGoal(")
  expect(source).not.toContain("new RandomLookAroundGoal(")
})

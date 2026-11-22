import { expect, test } from "bun:test"
import { STEADY_PRESETS } from "@minemods/mod-core/creature-steady"
import { steadyChosenWords } from "../src/renderer/features/steady-setting"

test("稳重的表单把档位说成每秒多少度：点名的档、按体型取到的档、不够高的、没写高度的", () => {
  expect(steadyChosenWords(null, 9)).toEqual([])
  const colossal = steadyChosenWords({ preset: "colossal" }, null)
  expect(colossal).toHaveLength(1)
  expect(colossal[0]).toContain(`平时身体每秒最多转 ${STEADY_PRESETS.colossal.body_turn}°`)
  expect(colossal[0]).toContain(`头每秒 ${STEADY_PRESETS.colossal.head.turn}°`)
  // 「按体型」 with the hitbox known: the one tier it takes, with its numbers.
  const auto = steadyChosenWords({ preset: "auto" }, 7.44)
  expect(auto).toHaveLength(1)
  expect(auto[0]).toContain("它的碰撞箱高 7.44 格")
  expect(auto[0]).toContain(STEADY_PRESETS.colossal.label)
  expect(auto[0]).toContain(`${STEADY_PRESETS.colossal.body_turn}°`)
  expect(steadyChosenWords({ preset: "auto" }, 4)[0]).toContain(STEADY_PRESETS.huge.label)
  expect(steadyChosenWords({ preset: "auto" }, 1.8)[0]).toContain("转身和以前一样")
  // No height written on the creature: all three, so the numbers can still be compared.
  expect(steadyChosenWords({ preset: "auto" }, null)).toHaveLength(4)
})

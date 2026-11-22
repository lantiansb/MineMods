import { expect, test } from "bun:test"
import { historyReach, NO_MAKING_RECORD_WORDS, versionWords } from "../src/renderer/features/making-history-model"
import { NO_NOTES, addNote, sendNotes, settleNotes } from "../src/making-notes"

const ASSET = "11111111-1111-4111-8111-111111111111"

test("「制作过程」：有 AI 制作记录就有；没有记录但保存过两版以上，只给各版；只有一版或还没读到，不给", () => {
  // A real making record: its story, whatever the versions.
  expect(historyReach({ making: true, assetId: ASSET, savedVersions: null })).toBe("making")
  expect(historyReach({ making: true, assetId: ASSET, savedVersions: 1 })).toBe("making")
  // A record for a thing never saved still has its story.
  expect(historyReach({ making: true, assetId: null, savedVersions: null })).toBe("making")
  // No record: the saved versions alone, once there are two to compare (an imported thing, a gameplay the naming conversion saved anew).
  expect(historyReach({ making: false, assetId: ASSET, savedVersions: 2 })).toBe("versions")
  expect(historyReach({ making: false, assetId: ASSET, savedVersions: 5 })).toBe("versions")
  // One version has nothing to compare or go back to; versions not read yet are not guessed at; nothing saved has no versions.
  expect(historyReach({ making: false, assetId: ASSET, savedVersions: 1 })).toBeNull()
  expect(historyReach({ making: false, assetId: ASSET, savedVersions: 0 })).toBeNull()
  expect(historyReach({ making: false, assetId: ASSET, savedVersions: null })).toBeNull()
  expect(historyReach({ making: false, assetId: null, savedVersions: 3 })).toBeNull()
})

test("版本下面的字：自动转换的那一版如实说是从旧命名换的，是现在这一版也照样说；别的照旧", () => {
  expect(versionWords({ by: "ai", from: null, current: false })).toBe("AI")
  expect(versionWords({ by: "person", from: null, current: false })).toBe("你改")
  expect(versionWords({ by: "restored", from: 1, current: false })).toBe("回到第 1 版")
  expect(versionWords({ by: "ai", from: null, current: true })).toBe("现在")
  expect(versionWords({ by: "restored", from: 1, current: true })).toBe("现在")
  expect(versionWords({ by: "converted", from: null, current: false })).toBe("从旧命名自动转换")
  expect(versionWords({ by: "converted", from: null, current: true })).toBe("现在 · 从旧命名自动转换")
  // Said where there is no making record: it does not claim one.
  expect(NO_MAKING_RECORD_WORDS).toContain("没有 AI 的制作记录")
})

test("自动转换的一版不算 AI 交来的：交出去的批注不会因此标成已改", () => {
  const at = "2026-11-14T08:00:00.000Z"
  const noted = addNote(NO_NOTES, { kind: "text", start: { x: 0.5, y: 0.5 }, text: "跳得再高一点", part: null, frame: null, camera: null }, { version: 1, at })
  const sent = sendNotes(noted, [1], { version: 1, at })
  expect(settleNotes(sent, [{ version: 1, by: "ai" }, { version: 2, by: "converted" }], at)).toBe(sent)
  expect(settleNotes(sent, [{ version: 1, by: "ai" }, { version: 2, by: "converted" }, { version: 3, by: "ai" }], at).notes[0]).toMatchObject({ status: "fixed", fixed_version: 3 })
})

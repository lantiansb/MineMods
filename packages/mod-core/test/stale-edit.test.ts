import { expect, test } from "bun:test"
import { assertFresh, followStored, STALE_EDIT, StaleEditError } from "../src/stale-edit"

const same = (left: string, right: string) => left === right

test("保存只认表格开头时的那一版：对不上就用同一句话拒绝，没说明开头版本的不是表格", () => {
  expect(STALE_EDIT.says).toBe("AI 刚改过这一样，你看到的是改之前的。")
  expect(() => assertFresh(2, 3)).toThrow(new StaleEditError())
  expect(() => assertFresh(2, 3)).toThrow("AI 刚改过这一样，你看到的是改之前的。")
  expect(() => assertFresh(3, 3)).not.toThrow()
  // A caller that is not a form says nothing about where it started, and a thing that is not stored yet has no version to compare.
  expect(() => assertFresh(undefined, 3)).not.toThrow()
  expect(() => assertFresh(2, undefined)).not.toThrow()
})

test("存着的东西在表格底下变了：没动过的表格跟着换，动过的表格留着人的字并说出来，变的不是它改的那部分就接着往下", () => {
  const started = { revision: 1, value: "旧的说明" }
  expect(followStored(started, { revision: 1, value: "旧的说明" }, true, same)).toBe("keep")
  // A newer revision that left what this form edits as it was: carry on from it, whether or not the person has typed.
  expect(followStored(started, { revision: 2, value: "旧的说明" }, true, same)).toBe("rebase")
  expect(followStored(started, { revision: 2, value: "旧的说明" }, false, same)).toBe("rebase")
  // The content changed: an untouched form shows it, an edited one must not silently take it nor silently keep the person's words as if they were current.
  expect(followStored(started, { revision: 2, value: "AI 写的新说明" }, false, same)).toBe("follow")
  expect(followStored(started, { revision: 2, value: "AI 写的新说明" }, true, same)).toBe("moved")
})

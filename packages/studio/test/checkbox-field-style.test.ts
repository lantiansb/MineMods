import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * r29c 乙 第 8 件: a tick box in the creature's hand form (the stagger group's 「招式被打断时触发」, 「累计来击破防」) was drawn as a white block the width of the form, because the
 * window's field look (`input { width: 100%; min-height: 38px; padding … }`, workbench.css) reached every input, tick boxes and round choices too. The rule now leaves those two out,
 * and at the specificity of a bare `input` (`:where`), so every rule that styles a text box more closely still wins over it as before.
 */
const css = readFileSync(path.join(import.meta.dir, "../src/renderer/workbench.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selectors: match[1]!.split(",").map((value) => value.trim()), body: match[2]! }))
const sizes = /(^|;|\s)(width\s*:\s*(?!auto)|min-height\s*:|height\s*:|padding\s*:)/

test("the window's field look does not reach tick boxes or round choices", () => {
  // No rule sizes or pads every input whatever it is.
  const bare = rules.filter((rule) => sizes.test(rule.body) && rule.selectors.some((selector) => /^input(:hover|:focus-visible)?$/.test(selector)))
  expect(bare.map((rule) => rule.selectors.join(", "))).toEqual([])
  // The field look itself is still there for the boxes that take text, as weak as before.
  const field = rules.find((rule) => /min-height:\s*38px/.test(rule.body) && rule.selectors.includes("textarea"))!
  expect(field.selectors).toContain('input:where(:not([type="checkbox"]):not([type="radio"]))')
  expect(field.body).toMatch(/width:\s*100%/)
})

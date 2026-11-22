import { expect, test } from "bun:test"
import { THEME } from "../src/renderer/themes"
import { readFileSync } from "node:fs"

const css = readFileSync(new URL("../src/renderer/themes.css", import.meta.url), "utf8")
const tokens = new Map([...css.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)].map(match => [match[1], match[2]!] as const))
function light(token: string) {
  const hex = tokens.get(token)
  if (!hex) throw new Error("缺少主题颜色 " + token)
  const [r,g,b] = [1,3,5].map(start => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
test("工作台主题的正文、标题、选中态和操作提示至少达到 4.5:1", () => {
  expect(tokens.get("bg")).toBe(THEME.background)
  expect(tokens.get("chrome")).toBe(THEME.titlebar)
  for (const [ink, background] of [
    ["text","bg"], ["text","slot"], ["muted","panel-soft"], ["on-accent","accent"], ["on-accent","accent-hover"],
    ["on-accent","stone"], ["on-accent","stone-hover"], ["accent-text","accent-dim"],
    ["wall-text","wall"], ["notice-ink","warning-bg"], ["field-text","field"], ["chrome-muted","chrome"],
    ["error-text","error-bg"], ["log-text","log-bg"], ["success","panel"], ["danger","panel"], ["warning","panel"],
  ] as const) {
    const a = light(ink), b = light(background)
    const ratio = (Math.max(a,b) + 0.05) / (Math.min(a,b) + 0.05)
    console.log(ink, background, ratio.toFixed(2))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  }
})

test("「只是设计稿」的徽标在深色的页头上仍是深色字：页头把段落都改成浅色字的那条规则不能盖住它", () => {
  const sheet = readFileSync(new URL("../src/renderer/features/asset-workspace.css", import.meta.url), "utf8")
  const readable = readFileSync(new URL("../src/renderer/readability.css", import.meta.url), "utf8")
  const chip = /\.asset-workspace-header p\.asset-design-note\s*\{[^}]*background:\s*(#[\da-f]{6})/i.exec(sheet)?.[1]
  // The rule that wins on the page: as specific as the one that paints every header paragraph in the wall's light ink, and after it.
  const ink = /:root \.main-area \.asset-workspace-header p\.asset-design-note\s*\{[^}]*color:\s*(#[\da-f]{6})/i.exec(readable)?.[1]
  expect(chip).toBeDefined()
  expect(ink).toBeDefined()
  expect(readable.indexOf("p.asset-design-note")).toBeGreaterThan(readable.indexOf(".asset-workspace-header p,"))
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((start) => {
      const channel = parseInt(hex.slice(start, start + 2), 16) / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }
  const a = lum(ink!), b = lum(chip!)
  expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5)
})

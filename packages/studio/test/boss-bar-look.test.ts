import { expect, test } from "bun:test"
import { BossBarDocumentSchema, bossBarLayout, bossBarMoments, drawBossBar, evenLines } from "@minemods/mod-core/boss-bar"
import { MakingRefusal } from "@minemods/mod-core/making"
import { decodeRgbaPng } from "@minemods/mod-core/png-decode"
import { decodeTextureDataUrl } from "@minemods/mod-core/content-texture"
import { BOSS_BAR_SHEET, lookJob, reviewJob } from "../src/main/look-job"

const bar = BossBarDocumentSchema.parse({
  kind: "bossbar",
  background: "bronze",
  fill: null,
  drain: "left",
  segments: [],
  lock: { frames: null, ticks: 4, at: [] },
  icons: [{ abilities: ["slam"], image: null, at: null }, { abilities: ["burst"], image: null, at: null }],
  names: [
    { zh: "苏醒", en: "Awakened" },
    { zh: "狂怒", en: "Enraged" },
    { zh: "垂死", en: "Last Stand" },
  ],
  name_at: null,
  dots: null,
})

test("a bar is looked at in the three states the reviewer judges it by, drawn from the same layout and rules as the game's HUD", () => {
  const made = lookJob(bar, null)
  expect(made.job.scenes).toEqual([])
  expect(made.job.sheets).toHaveLength(1)
  const sheet = made.job.sheets[0]!
  expect(sheet.label).toBe(BOSS_BAR_SHEET)
  expect(sheet.cells.map((cell) => cell.label.split(" · ")[0])).toEqual(["满血", "刚过第一条线（67%），血量 66%，锁正在碎（第 3/4 帧）", "残血 5%", "满血", "锁碎开的 4 帧（第 1 帧是完整的锁，每帧 4 tick）", "底图原样（232×42）"])
  // Each of the three is the picture drawBossBar gives for that moment, pixel for pixel.
  const layout = bossBarLayout(bar)
  const lines = evenLines(3)
  bossBarMoments(layout, lines).forEach((moment, index) => {
    const cell = sheet.cells[index]!
    if (cell.kind !== "tiles") throw new Error("a bar's moment is a tiles cell")
    const shown = decodeRgbaPng(decodeTextureDataUrl(cell.textures[0]!))
    expect(Buffer.from(shown.pixels).equals(Buffer.from(drawBossBar(layout, lines, moment.state).pixels))).toBe(true)
  })
  // The three differ from each other.
  const urls = sheet.cells.slice(0, 3).map((cell) => (cell.kind === "tiles" ? cell.textures[0] : ""))
  expect(new Set(urls).size).toBe(3)
  expect(made.notes.join("")).toContain("3 个阶段：1.「苏醒」（Awakened） 2.「狂怒」（Enraged） 3.「垂死」（Last Stand）")
  expect(made.notes.join("")).toContain("第 1 个（slam）")
  expect(made.notes.join("")).not.toContain("原版血条")
  // The review is the same sheet: a bar is whole in one look.
  expect(reviewJob(bar, null).job.sheets.map((value) => value.label)).toEqual([BOSS_BAR_SHEET])
})

test("a bar whose picture cannot be read is refused in plain words, not drawn half", () => {
  const broken = { ...bar, icons: [{ abilities: ["slam"], image: "data:image/png;base64,AAAA", at: null }] }
  expect(() => lookJob(broken, null)).toThrow(MakingRefusal)
})

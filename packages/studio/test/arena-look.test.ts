import { expect, test } from "bun:test"
import { fitModelAtlas } from "@minemods/mod-core/model"
import { decodeRgbaPng } from "@minemods/mod-core/png-decode"
import { foggedTexture, fogShare } from "@minemods/mod-core/arena-picture"
import { ARENA_SHEET, FOG_SHEET, arenaLookSheets } from "../src/main/arena-look"
import { lookJob } from "../src/main/look-job"
import { chiyouDesign, compassFixture, fogAbility, zhuoluAbility, ARENA_SAMPLE_IDS } from "../../mod-core/script/target-arena-sample"

/** Boss 能力 12 and 13 in a creature's look: the arena from above, 涿鹿 from above with its time, and 「雾里看它」; a fixture by itself. */

const boss = {
  bar: { color: "red", style: "progress", darken_sky: false },
  intro: null,
  phases: [],
  death: { seconds: 2, xp_bursts: 0, explosion: false },
  leash: null,
  arena: {
    fixtures: [{ id: "compass", look: { asset: ARENA_SAMPLE_IDS.compass }, place: { ring: { count: 4, radius: 10 } }, use: { seconds: 1, cooldown: 3 }, clear: { radius: 6, seconds: 30 } }],
    fog: { visibility: 6, fade_seconds: 1, boss_damage: 1.5, damage_taken: 0.5, lift: "all_lit_once" as const },
  },
}
const dataUrl = (png: Uint8Array) => `data:image/png;base64,${Buffer.from(png).toString("base64")}`

test("a boss with an arena: its arena and its 涿鹿 from above, three distances in its fog drawn with what glows kept; facts and checks said", () => {
  const compiled = fitModelAtlas(chiyouDesign as never, "look")
  const made = arenaLookSheets({ document: { name: "蚩尤", behavior: "hostile", boss: boss as never, abilities: [fogAbility, zhuoluAbility] }, compiled, first: 3, tile: [400, 300], dataUrl })
  expect(made.sheets.map((sheet) => sheet.label)).toEqual([ARENA_SHEET, FOG_SHEET])
  expect(made.sheets[0]!.cells.map((cell) => cell.label)).toEqual([
    "场地俯视（72×72 格）：4 座物件，清晰区半径 6 格，战斗范围 32 格",
    "「涿鹿」俯视和时间（0–9 秒）：第 0.4 秒–8 秒 不在场上，落回场地正中；打整个场地 第 4 秒，安全区 4 处",
  ])
  expect(made.scenes).toHaveLength(3)
  expect(made.sheets[1]!.cells.map((cell) => (cell.kind === "view" ? cell.scene : -1))).toEqual([3, 4, 5])
  expect(made.sheets[1]!.cells.map((cell) => cell.label)).toEqual(["不在雾里（或者站在亮着的物件旁边）", "雾里离它 3.6 格（能见度 6 格，雾占 50%）", "雾里离它 7.2 格（能见度 6 格，雾占 100%）"])
  const notes = made.notes.join("\n")
  expect(notes).toContain("只剩发光的部分")
  expect(notes).toContain("地面预警圈、效果和粒子会随雾变淡")
  expect(fogShare(24, 10, 36)).toBeCloseTo(22 / 34)
  expect(notes).toContain("起雾的招式在第一阶段能出")
  expect(notes).toContain("图上安全区按物件全都亮着画")
  // Far in the fog, what does not glow is the fog's grey; what glows is still bright.
  const far = decodeRgbaPng(foggedTexture(compiled.png, compiled.glow, fogShare(7.2, 6)))
  const mask = decodeRgbaPng(compiled.glow!)
  let grey = 0
  let bright = 0
  for (let index = 0; index < far.pixels.length; index += 4) {
    if (far.pixels[index + 3] === 0) continue
    if (mask.pixels[index + 3]! > 0) bright += far.pixels[index]! + far.pixels[index + 1]! + far.pixels[index + 2]! > 300 ? 1 : 0
    else grey += far.pixels[index] === 140 && far.pixels[index + 1] === 144 && far.pixels[index + 2] === 152 ? 1 : 0
  }
  expect(grey).toBeGreaterThan(100)
  expect(bright).toBeGreaterThan(4)
})

test("a creature without an arena gets none of it", () => {
  expect(arenaLookSheets({ document: { name: "石像", behavior: "hostile", boss: { ...boss, arena: null } as never, abilities: [] }, compiled: null, first: 0, tile: [400, 300], dataUrl })).toEqual({ scenes: [], sheets: [], notes: [] })
})

test("a fixture by itself: six sides, its lit and its dark motion frame by frame, what was measured", () => {
  const looked = lookJob(compassFixture as never, null)
  expect(looked.job.sheets.map((sheet) => sheet.label)).toEqual(["六个角度（它做好的样子）", "点亮以后「lit」", "没点亮时「dark」"])
  expect(looked.notes.join()).toContain("它在游戏里占 0.875×1.313 格")
})

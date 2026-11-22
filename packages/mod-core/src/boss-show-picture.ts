import { TICKS } from "./ability-words"
import { BOSS_SHOW_KINDS, bossShowOrder, bossShowStepWords, type BossShowKind, type BossShowName, type BossShowStep } from "./boss-show"
import { encodePng } from "./png"
import type { Boss } from "./entity-runtime"

/**
 * Boss 能力 15 as what a reviewer looks at (the app's look draws it, `studio/src/main/look-job.ts`): per show, a timeline strip with every step at its moment, one
 * row per kind of step, and the moments worth a picture of the model (as the show leaves it then: bones hidden, glow, the motion's pose).
 * No Node APIs: the app's window reads it too.
 */

const num = (value: number, digits = 2) => Number(value.toFixed(digits))

/** The colour of each kind of step on the strip, and its name in the legend. */
export const SHOW_KIND_COLOURS: Record<BossShowKind, readonly [number, number, number]> = {
  stance: [180, 130, 250],
  fixture: [220, 160, 60],
  clip: [96, 170, 255],
  sound: [245, 245, 245],
  particle: [190, 190, 120],
  effect: [230, 120, 230],
  shake: [255, 150, 60],
  glow: [255, 70, 40],
  drop: [150, 110, 80],
  place_structure: [110, 210, 120],
  weather: [120, 200, 230],
}
const COLOUR_NAMES: Record<BossShowKind, string> = { stance: "浅紫", fixture: "金", clip: "蓝", sound: "白", particle: "土黄", effect: "紫", shake: "橙", glow: "红", drop: "棕", place_structure: "绿", weather: "青" }
const KINDS = Object.keys(BOSS_SHOW_KINDS) as BossShowKind[]

export { bossShowTimeline, type ShowTimeline } from "./boss-show-timeline"
import type { ShowTimeline } from "./boss-show-timeline"

/**
 * A show's timeline as a picture `width` × `height`: one row per kind of step, each step a mark at its moment in its kind's colour, a grey line every second,
 * a red line where the show's own seconds end when its steps run later (what the runtime adds is shaded). The legend and the scale are returned beside it.
 */
export function showTimelinePicture(timeline: ShowTimeline, width = 720, height = 120) {
  const pixels = new Uint8Array(width * height * 4)
  const left = 8
  const right = width - 8
  const top = 6
  const kinds = timeline.steps.some(step => step.kind === "stance") ? KINDS : KINDS.filter(kind => kind !== "stance")
  const row = Math.floor((height - top - 6) / kinds.length)
  const x = (seconds: number) => left + Math.round(((right - left) * seconds) / Math.max(0.05, timeline.seconds))
  const fill = (x0: number, y0: number, x1: number, y1: number, colour: readonly [number, number, number]) => {
    for (let py = Math.max(0, y0); py < Math.min(height, y1); py++) for (let px = Math.max(0, x0); px < Math.min(width, x1); px++) pixels.set([colour[0], colour[1], colour[2], 255], (py * width + px) * 4)
  }
  fill(0, 0, width, height, [24, 26, 30])
  kinds.forEach((_, index) => index % 2 && fill(left, top + index * row, right, top + (index + 1) * row, [30, 33, 38]))
  if (timeline.seconds > timeline.written + 1e-9) fill(x(timeline.written), top, right + 1, top + kinds.length * row, [52, 30, 32])
  for (let second = 0; second <= timeline.seconds + 1e-9; second++) fill(x(second), top, x(second) + 1, top + kinds.length * row, [70, 74, 82])
  for (const moment of timeline.moments) fill(x(moment.at), height - 5, x(moment.at) + 2, height, [200, 200, 200])
  if (timeline.seconds > timeline.written + 1e-9) fill(x(timeline.written), top, x(timeline.written) + 2, top + kinds.length * row, [230, 60, 60])
  for (const step of timeline.steps) {
    const lane = kinds.indexOf(step.kind)
    const at = x(step.at)
    fill(at - 1, top + lane * row + 1, at + 3, top + (lane + 1) * row - 1, SHOW_KIND_COLOURS[step.kind])
  }
  const used = kinds.filter((kind) => timeline.steps.some((step) => step.kind === kind))
  return {
    png: encodePng(pixels, width, height),
    legend: `从上到下每行一种：${kinds.map((kind) => `${BOSS_SHOW_KINDS[kind]}（${COLOUR_NAMES[kind]}）`).join("、")}；用到的：${used.map((kind) => BOSS_SHOW_KINDS[kind]).join("、")}`,
    scale: `横轴 0–${num(timeline.seconds)} 秒，灰线每秒一条，底下白点是下面画了模型的时刻${timeline.seconds > timeline.written + 1e-9 ? `；红线是写的 ${num(timeline.written)} 秒，红底是步骤拖长出来的部分` : ""}`,
  }
}

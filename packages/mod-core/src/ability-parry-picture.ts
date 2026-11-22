import { TICKS } from "./ability-words"
import type { ParryTimeline } from "./ability-parry"
import { encodePng } from "./png"

/**
 * Boss 能力 14 as a picture a reviewer reads (the app's look draws it, `studio/src/main/look-job.ts`): one answered blow on a time line, from the blow on, in the numbers the
 * generated Java runs on (`parryTimeline`). Top row: the ability (getting ready in a darker blue, the rest lighter), a red mark at each hit; middle row: the wait before
 * it may start again (grey); bottom row: the attacker's disarm (orange). A white line at 0 is the blow, a grid line every second. What each colour is, the label says.
 */
export const PARRY_COLOURS = { back: [24, 26, 30], grid: [60, 64, 72], axis: [140, 140, 150], blow: [245, 245, 245], windup: [40, 90, 170], ability: [90, 150, 235], hit: [230, 60, 60], wait: [110, 112, 120], disarm: [240, 150, 40] } as const

export function parryTimelinePicture(line: ParryTimeline, width = 480, height = 180) {
  const pixels = new Uint8Array(width * height * 4)
  const left = 12
  const right = width - 12
  const span = Math.max(line.ready, line.disarm ?? 0, 1 / TICKS)
  const x = (seconds: number) => left + Math.round(((right - left) * seconds) / span)
  const fill = (x0: number, y0: number, x1: number, y1: number, colour: readonly [number, number, number]) => {
    for (let py = Math.max(0, y0); py < Math.min(height, y1); py++) for (let px = Math.max(0, x0); px < Math.min(width, x1); px++) pixels.set([colour[0], colour[1], colour[2], 255], (py * width + px) * 4)
  }
  fill(0, 0, width, height, PARRY_COLOURS.back)
  for (let second = 0; second <= span + 1e-9; second++) fill(x(second), 8, x(second) + 1, height - 8, PARRY_COLOURS.grid)
  fill(left, height - 9, right + 1, height - 8, PARRY_COLOURS.axis)
  // The rows: the ability, the wait, the disarm.
  const rows = [
    { top: 20, bottom: 60 },
    { top: 76, bottom: 106 },
    { top: 122, bottom: 152 },
  ] as const
  fill(x(0), rows[0].top, Math.max(x(line.windup), x(0) + 1), rows[0].bottom, PARRY_COLOURS.windup)
  fill(x(line.windup), rows[0].top, Math.max(x(line.end), x(line.windup) + 1), rows[0].bottom, PARRY_COLOURS.ability)
  for (const hit of line.hits) fill(x(hit.at) - 1, rows[0].top - 8, x(hit.at) + 2, rows[0].bottom + 8, PARRY_COLOURS.hit)
  if (line.ready > line.end) fill(x(line.end), rows[1].top, x(line.ready), rows[1].bottom, PARRY_COLOURS.wait)
  if (line.disarm !== null) fill(x(0), rows[2].top, Math.max(x(line.disarm), x(0) + 1), rows[2].bottom, PARRY_COLOURS.disarm)
  fill(x(0) - 1, 8, x(0) + 2, height - 8, PARRY_COLOURS.blow)
  return { png: encodePng(pixels, width, height), seconds: Number(span.toFixed(2)), x }
}

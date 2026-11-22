import type { SteadyPlan } from "./creature-steady"
import { encodePng } from "./png"

export function steadyPicture(plan: SteadyPlan, stand = 0) {
  const size = 240
  const pixels = new Uint8Array(size * size * 4)
  const run = plan.body_turn > 0 ? 321 / plan.body_turn : 0
  const scale = 100 / Math.max(run, stand, 3)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - size / 2, dy = y - size / 2
    const radius = Math.hypot(dx, dy)
    const angle = Math.abs(Math.atan2(dx, -dy) * 180 / Math.PI)
    const wedge = radius < 94 && angle <= plan.head.yaw
    const colour = Math.abs(dx) < 2 && dy < 0 && dy > -42 || radius < 7 ? [250,250,250] :
      stand > 0 && Math.abs(radius - stand * scale) < 1.5 ? [245,178,67] :
      run > 0 && Math.abs(radius - run * scale) < 1.5 ? [238,115,117] :
      run > 0 && wedge && angle <= plan.turn_after ? [62,137,153] : wedge ? [48,83,112] : [25,32,42]
    pixels.set([...colour, 255], (y * size + x) * 4)
  }
  const n = (value: number) => Number(value.toFixed(2))
  return { png: encodePng(pixels, size, size), label: `白线指向正前方。蓝色是头能偏开的范围（左右各 ${plan.head.yaw}°）${run > 0 ? `，青色是站定转身的门槛（${plan.turn_after}°）。红圈以内疾跑能绕到背后（${n(run)} 格）。` : "。平时身体不跟转，只在出招时转。"}${stand ? `黄圈内站定（${stand} 格）。` : ""}${run > 0 ? `身体转半圈要 ${n(180 / plan.body_turn)} 秒，` : ""}头从正前转到最偏要 ${n(plan.head.yaw / plan.head.turn)} 秒。${plan.focus ? `至少盯住目标 ${plan.focus.hold ?? 0} 秒。` : ""}` }
}

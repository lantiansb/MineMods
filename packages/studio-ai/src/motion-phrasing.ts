import { channelTracks, clipCursor, sampleTrack, TRACK_MOVES, trackSpan, type Clip } from "./animation"
import type { ModelDesign } from "./contracts"

/**
 * 第 2 步: how one motion is phrased, measured tick by tick — the facts a look gives for every motion besides how far it moves
 * (`model-motion.ts`) and whether it holds together (`motion-continuity.ts`): how many bones it moves, how fast the fastest of them
 * turns and when, how long it moves the other way first (the wind-up before the strike) and how long it takes after the strike to
 * come to rest. Measured from the document alone; nothing here knows what the thing is.
 *
 * The strike is the moment some rotation axis of some bone turns fastest (degrees a second, between two ticks). Its stretch is the
 * run of ticks around it in which that axis keeps turning the same way at more than `PHRASING.moving` of that speed. The wind-up is
 * the run of ticks right before that stretch in which the same axis turns the other way (or holds, between two such) — the
 * anticipation — and the recovery is from the end of that stretch to the last tick anything still turns.
 */

type Vec = [number, number, number]
const TICK = 1 / 20

/**
 * `turn`: degrees a rotation track must span, and `TRACK_MOVES` a position or scale track, for its bone to count as moved.
 * `moving`: the share of the strike's speed above which its axis still counts as striking.
 * Epic (attack clips of 2–8 s, 20–40 bones moving at once, a clear wind-up and recovery):
 * `bones` moved in an attack clip, or `share` of the model's parts when it has fewer; `anticipation` and `recovery` in ticks.
 */
export const PHRASING = { turn: 1, moving: 0.2, epic: { bones: 20, share: 0.6, anticipation: 4, recovery: 6 } } as const

export function measurePhrasing(design: Pick<ModelDesign, "bones">, clip: Clip & { name: string }) {
  const known = clip.channels.filter((channel) => design.bones.some((bone) => bone.name === channel.bone))
  const moved = known.filter((channel) => {
    const tracks = channelTracks(channel)
    return trackSpan(tracks.rotation) >= PHRASING.turn || trackSpan(tracks.position) >= TRACK_MOVES.position || trackSpan(tracks.scale) >= TRACK_MOVES.scale
  })
  const scaled = known.filter((channel) => trackSpan(channelTracks(channel).scale) >= TRACK_MOVES.scale).length
  const ticks = Math.max(1, Math.round(clip.length / TICK))
  const at = (keys: ReturnType<typeof channelTracks>["rotation"], tick: number): Vec => sampleTrack(keys, clipCursor(clip, Math.min(tick * TICK, clip.length)), clip.loop) ?? [0, 0, 0]
  // Degrees a second of every rotation axis between tick t-1 and t.
  const speeds = known.flatMap((channel) => {
    const keys = channelTracks(channel).rotation
    if (!keys.length) return []
    const poses = Array.from({ length: ticks + 1 }, (_, tick) => at(keys, tick))
    return [0, 1, 2].map((axis) => ({ bone: channel.bone, axis, speed: poses.map((pose, tick) => (tick === 0 ? 0 : (pose[axis]! - poses[tick - 1]![axis]!) / TICK)) }))
  })
  const peak = speeds.reduce<{ bone: string; axis: number; tick: number; speed: number } | null>((best, track) => {
    // The earliest of equal speeds (a thousandth of a degree a second apart is equal): a strike comes before the way back.
    const tick = track.speed.reduce((most, value, index) => (Math.abs(value) > Math.abs(track.speed[most]!) + 1e-3 ? index : most), 0)
    return Math.abs(track.speed[tick]!) > Math.abs(best?.speed ?? 0) + 1e-3 ? { bone: track.bone, axis: track.axis, tick, speed: track.speed[tick]! } : best
  }, null)
  const none = { name: clip.name, ticks, bones_moved: moved.length, scaled, peak_speed: 0, peak_bone: null as string | null, strike_at: null as number | null, anticipation: 0, recovery: 0 }
  if (!peak || Math.abs(peak.speed) < 1) return none
  const track = speeds.find((value) => value.bone === peak.bone && value.axis === peak.axis)!.speed
  const way = Math.sign(peak.speed)
  const striking = (tick: number) => Math.sign(track[tick]!) === way && Math.abs(track[tick]!) > PHRASING.moving * Math.abs(peak.speed)
  let start = peak.tick
  while (start > 1 && striking(start - 1)) start--
  let end = peak.tick
  while (end < ticks && striking(end + 1)) end++
  // The wind-up: before the strike's slow start (turning its way, under `PHRASING.moving` of its speed), the ticks turning the other
  // way, and the holds among and right after them.
  const against = (tick: number) => Math.sign(track[tick]!) === -way && Math.abs(track[tick]!) > 1
  const still = (tick: number) => Math.abs(track[tick]!) <= 1
  let tick = start - 1
  while (tick >= 1 && !against(tick) && !still(tick)) tick--
  const last = tick
  let first = -1
  while (tick >= 1 && (against(tick) || still(tick))) {
    if (against(tick)) first = tick
    tick--
  }
  const anticipation = first < 0 ? 0 : last - first + 1
  // The recovery: from the end of the strike to the last tick anything still turns (a held pose after it is not recovery).
  const settled = Math.max(0, ...speeds.map((value) => value.speed.reduce((latest, speed, at) => (Math.abs(speed) > 1 ? at : latest), 0)))
  return { ...none, peak_speed: Math.round(Math.abs(peak.speed)), peak_bone: peak.bone, strike_at: Number((peak.tick * TICK).toFixed(2)), anticipation, recovery: Math.max(0, settled - end) }
}

export type Phrasing = ReturnType<typeof measurePhrasing>

/** The facts in one sentence, said with every look beside a motion's other facts. */
export function phrasingLine(found: Phrasing, label: string) {
  if (found.strike_at === null) return `${label}的节奏：${found.bones_moved} 根骨骼在动，没有哪根转得快到算得上出手。`
  return (
    `${label}的节奏（按游戏每秒 20 刻量）：${found.bones_moved} 根骨骼在动${found.scaled ? `（其中 ${found.scaled} 根有缩放）` : ""}；转得最快的是「${found.peak_bone}」，在 ${found.strike_at} 秒每秒转 ${found.peak_speed} 度；` +
    `在它之前往反方向转（蓄势）${found.anticipation} 刻，出手以后到所有骨骼停下还有 ${found.recovery} 刻（收势）。`
  )
}

/** How many bones an epic attack clip has to move: twenty, or `PHRASING.epic.share` of the parts of a model that has fewer. */
export const epicBones = (design: Pick<ModelDesign, "bones">) => Math.min(PHRASING.epic.bones, Math.ceil(PHRASING.epic.share * design.bones.filter((bone) => bone.cubes.length > 0).length))

/** What an epic attack clip misses of the phrasing the guide asks for, in the maker's words; empty when it has all of it. */
export function epicPhrasingFaults(design: Pick<ModelDesign, "bones">, found: Phrasing, label: string) {
  const bones = epicBones(design)
  return [
    ...(found.bones_moved < bones ? [`${label}只有 ${found.bones_moved} 根骨骼在动，史诗档的攻击动作至少要 ${bones} 根一起动（身体、头、四肢、武器、尾巴、披挂都跟着出力）。`] : []),
    ...(found.strike_at !== null && found.anticipation < PHRASING.epic.anticipation ? [`${label}出手之前往反方向蓄势只有 ${found.anticipation} 刻，史诗档至少 ${PHRASING.epic.anticipation} 刻（${PHRASING.epic.anticipation / 20} 秒）。`] : []),
    ...(found.strike_at !== null && found.recovery < PHRASING.epic.recovery ? [`${label}出手以后到停下只有 ${found.recovery} 刻，史诗档至少 ${PHRASING.epic.recovery} 刻（${PHRASING.epic.recovery / 20} 秒）的收势，让动作有余势、再回到站姿。`] : []),
  ]
}

/**
 * The exact sentences an epic creature's maker is given about its attack motions (第 2 步). Said beside the animation contract,
 * only at the epic tier: lower tiers are told nothing new.
 */
export const EPIC_MOTION_GUIDE =
  `史诗档生物的攻击动作（招式用的动作和 attack）都要有四段：` +
  `蓄势（anticipation）——出手之前先往反方向收、抬、拧，至少 ${PHRASING.epic.anticipation} 刻（${PHRASING.epic.anticipation / 20} 秒），越重的招蓄得越久；` +
  `出手（strike）——最快的那一下，用 easeIn 一类的缓动或者 bezier 让它越来越快地砸下去；` +
  `余势（follow-through）——出手以后不要立刻停住，身体、武器、披挂顺着惯性再走一段，用 easeOut、Back 或者 follow 的骨骼；` +
  `收势（recovery）——慢慢回到站姿，出手以后到动作结束至少 ${PHRASING.epic.recovery} 刻（${PHRASING.epic.recovery / 20} 秒）。` +
  `一个攻击动作里至少 ${PHRASING.epic.bones} 根骨骼一起动（骨骼不到那么多的模型，至少 ${Math.round(PHRASING.epic.share * 100)}% 的部件）：不只是挥武器的那条胳膊，身体要拧、头要跟、另一侧的手和腿要配合，蓄势时缩放（scale）做出吸气、压缩，出手时拉伸。` +
  `攻击动作一般 2 到 8 秒；动作之间写 blend 过渡几 tick，边走边打的招式写 layered，披风、旗子、尾巴、头发、链子写进 follow。` +
  `每次看图的 motion_facts 里每个动作有一句「节奏」，是逐刻量出来的：多少根骨骼在动、最快的一下在哪一刻每秒转多少度、蓄势几刻、收势几刻——按它判断，攻击动作差的会出现在 findings 里。`

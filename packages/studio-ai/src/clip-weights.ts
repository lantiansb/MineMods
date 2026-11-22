export const LAYERS = ["look", "sway", "follow", "hang"] as const
export type Layer = typeof LAYERS[number]
export type Keys = readonly { time: number; value: number }[]
export type ClipWeights = Partial<Record<Layer, Keys | null>>
export function weightAt(keys: Keys | null | undefined, seconds: number) {
  if (!keys?.length) return 1
  if (seconds <= keys[0]!.time) return keys[0]!.value
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!, b = keys[i]!
    if (seconds <= b.time) return a.value + (b.value - a.value) * (seconds - a.time) / (b.time - a.time)
  }
  return keys[keys.length - 1]!.value
}
export const weightSlew = (previous: number, target: number, ticks: number) =>
  previous + Math.sign(target - previous) * Math.min(Math.abs(target - previous), 0.2 * Math.max(0, ticks))
export function clipWeightSampler(weights: ClipWeights, length: number) {
  const frames = LAYERS.map(layer => {
    const values = [1]
    for (let i = 1; i <= Math.ceil(length * 20); i++)
      values.push(weightSlew(values[i - 1]!, weightAt(weights[layer], i / 20), 1))
    return values
  })
  return (layer: Layer, time: number) => {
    const v = frames[LAYERS.indexOf(layer)]!
    const at = Math.max(0, Math.min(v.length - 1, time * 20)), lo = Math.floor(at)
    return v[lo]! + (v[Math.ceil(at)]! - v[lo]!) * (at - lo)
  }
}

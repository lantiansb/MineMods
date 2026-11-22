import { z } from "zod"
import { SOUND_LIMITS } from "../sound"

/**
 * Studio's own sound maker (工具资产 `sound-synth`): an outside AI writes a recipe — layers of a waveform or noise, each with a pitch that may slide, an envelope,
 * filters and a wobble, laid on a time line — and Studio renders it to a mono wave file. Any AI can make a sound this way by itself, with no service; the file then
 * goes the way every made sound goes (turned into the game's OGG). The arithmetic is plain and the same everywhere: the same recipe gives the same samples (noise
 * included: it is drawn from a fixed seed).
 */

export const SYNTH_RATE = 22050
export const SYNTH_LIMITS = { layers: 16, hz: { min: 10, max: 12000 } } as const

const seconds = z.number().finite().min(0).max(SOUND_LIMITS.seconds)
const hz = z.number().finite().min(SYNTH_LIMITS.hz.min).max(SYNTH_LIMITS.hz.max)

export const SynthLayerSchema = z.strictObject({
  wave: z.enum(["sine", "square", "saw", "triangle", "noise"]),
  /** The pitch at its start and at its end (Hz), slid between them on a log scale; noise takes them as the middle of its band (`lowpass_hz` / `highpass_hz` shape it more). */
  from_hz: hz.default(220),
  to_hz: hz.optional(),
  /** When it begins and how long it lasts, in seconds of the sound. */
  start: seconds.default(0),
  length: z.number().finite().min(0.01).max(SOUND_LIMITS.seconds),
  gain: z.number().finite().min(0).max(1).default(0.5),
  /** The envelope: rising, falling to `sustain` (a share of the gain), holding, and dying away at the end — all in seconds within its length. */
  attack: seconds.default(0.01),
  decay: seconds.default(0.1),
  sustain: z.number().finite().min(0).max(1).default(0.7),
  release: seconds.default(0.1),
  lowpass_hz: hz.optional(),
  highpass_hz: hz.optional(),
  /** A wobble of the pitch: how fast and how deep (a share of the pitch). */
  vibrato_hz: z.number().finite().min(0).max(40).default(0),
  vibrato_depth: z.number().finite().min(0).max(0.5).default(0),
})

export const SynthRecipeSchema = z
  .strictObject({
    seconds: z.number().finite().min(0.05).max(SOUND_LIMITS.seconds),
    layers: z.array(SynthLayerSchema).min(1).max(SYNTH_LIMITS.layers),
  })
  .superRefine((recipe, context) =>
    recipe.layers.forEach((layer, index) => {
      if (layer.start >= recipe.seconds) context.addIssue({ code: "custom", path: ["layers", index, "start"], message: `第 ${index + 1} 层在声音结束（${recipe.seconds} 秒）以后才开始，听不到` })
    }),
  )
export type SynthRecipe = z.infer<typeof SynthRecipeSchema>

/** Reads a recipe written as JSON text, with its problems in plain words. */
export function readSynthRecipe(text: string): SynthRecipe {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`合成配方不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = SynthRecipeSchema.safeParse(value)
  if (!parsed.success) throw new Error(`合成配方不对：${parsed.error.issues.map((issue) => `${issue.path.join(".") || "（整份）"}：${issue.message}`).join("；")}`)
  return parsed.data
}

/** The samples of a recipe, mono at `SYNTH_RATE`, peaking no higher than 0.9. */
export function renderSynth(recipe: SynthRecipe): Float32Array {
  const total = Math.max(1, Math.round(recipe.seconds * SYNTH_RATE))
  const out = new Float32Array(total)
  let seed = 0x9e3779b9
  const noise = () => {
    // xorshift32: the same noise for the same recipe.
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return ((seed >>> 0) / 0xffffffff) * 2 - 1
  }
  for (const layer of recipe.layers) {
    const begin = Math.round(layer.start * SYNTH_RATE)
    const count = Math.min(total - begin, Math.round(layer.length * SYNTH_RATE))
    if (count <= 0) continue
    const to = layer.to_hz ?? layer.from_hz
    let phase = 0
    let low = 0
    let highIn = 0
    let highOut = 0
    const lowAlpha = layer.lowpass_hz ? 1 - Math.exp((-2 * Math.PI * layer.lowpass_hz) / SYNTH_RATE) : 1
    const highAlpha = layer.highpass_hz ? 1 / (1 + (2 * Math.PI * layer.highpass_hz) / SYNTH_RATE) : 0
    for (let index = 0; index < count; index++) {
      const time = index / SYNTH_RATE
      const along = count > 1 ? index / (count - 1) : 0
      const pitch = layer.from_hz * Math.pow(to / layer.from_hz, along) * (1 + layer.vibrato_depth * Math.sin(2 * Math.PI * layer.vibrato_hz * time))
      phase = (phase + pitch / SYNTH_RATE) % 1
      const raw =
        layer.wave === "sine" ? Math.sin(2 * Math.PI * phase) : layer.wave === "square" ? (phase < 0.5 ? 1 : -1) : layer.wave === "saw" ? 2 * phase - 1 : layer.wave === "triangle" ? 1 - 4 * Math.abs(phase - 0.5) : noise()
      // One-pole filters: a low pass smooths, a high pass keeps only the change.
      low += lowAlpha * (raw - low)
      const shaped = layer.highpass_hz ? (highOut = highAlpha * (highOut + low - highIn)) : low
      highIn = low
      const left = layer.length - time
      const envelope =
        time < layer.attack ? time / Math.max(layer.attack, 1e-6) : time < layer.attack + layer.decay ? 1 - (1 - layer.sustain) * ((time - layer.attack) / Math.max(layer.decay, 1e-6)) : layer.sustain
      const fade = left < layer.release ? Math.max(0, left / Math.max(layer.release, 1e-6)) : 1
      out[begin + index]! += shaped * envelope * fade * layer.gain
    }
  }
  let peak = 0
  for (const value of out) peak = Math.max(peak, Math.abs(value))
  if (peak > 0.9) for (let index = 0; index < total; index++) out[index]! *= 0.9 / peak
  return out
}

/** Source PCM levels and energy in three bands, summed over short Hann windows. */
export function measureSynth(samples: Float32Array) {
  const size = 2048
  const real = new Float64Array(size)
  const imaginary = new Float64Array(size)
  const window = Float64Array.from({ length: size }, (_, index) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (index + 0.5) / size))
  const energy = { low: 0, mid: 0, high: 0 }
  let peak = 0
  let squares = 0
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample))
    squares += sample * sample
  }
  for (let offset = -size / 2; offset + size / 2 < samples.length; offset += size / 2) {
    // Bit-reversed input puts the even and odd terms next to each other for the FFT butterflies.
    for (let index = 0, reversed = 0; index < size; index++) {
      real[reversed] = (samples[offset + index] ?? 0) * window[index]!
      imaginary[reversed] = 0
      let bit = size >> 1
      while (bit && (reversed & bit)) {
        reversed ^= bit
        bit >>= 1
      }
      reversed ^= bit
    }
    for (let width = 2; width <= size; width *= 2) {
      for (let index = 0; index < width / 2; index++) {
        const phase = -2 * Math.PI * index / width
        const cos = Math.cos(phase)
        const sin = Math.sin(phase)
        for (let left = index; left < size; left += width) {
          const right = left + width / 2
          const x = real[right]! * cos - imaginary[right]! * sin
          const y = real[right]! * sin + imaginary[right]! * cos
          real[right] = real[left]! - x
          imaginary[right] = imaginary[left]! - y
          real[left]! += x
          imaginary[left]! += y
        }
      }
    }
    for (let bin = 1; bin <= size / 2; bin++) {
      const hz = bin * SYNTH_RATE / size
      energy[hz < 250 ? "low" : hz < 2000 ? "mid" : "high"] += real[bin]! ** 2 + imaginary[bin]! ** 2
    }
  }
  const strongest = (["low", "mid", "high"] as const).reduce((best, band) => energy[band] > energy[best] ? band : best)
  const rounded = (value: number) => Number(value.toFixed(5))
  return {
    seconds: rounded(samples.length / SYNTH_RATE),
    peak: rounded(peak),
    rms: rounded(Math.sqrt(squares / Math.max(1, samples.length))),
    clipped: peak >= 1,
    dominant_band: energy[strongest] > 0 ? strongest : null,
  }
}

/** Samples as a 16-bit mono WAV file. */
export function wavFile(samples: Float32Array, rate = SYNTH_RATE): Uint8Array {
  const data = samples.length * 2
  const buffer = Buffer.alloc(44 + data)
  buffer.write("RIFF", 0, "ascii")
  buffer.writeUInt32LE(36 + data, 4)
  buffer.write("WAVEfmt ", 8, "ascii")
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36, "ascii")
  buffer.writeUInt32LE(data, 40)
  samples.forEach((value, index) => buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + index * 2))
  return new Uint8Array(buffer)
}

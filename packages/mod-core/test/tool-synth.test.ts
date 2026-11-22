import { expect, test } from "bun:test"
import { SYNTH_RATE, readSynthRecipe, measureSynth, renderSynth, wavFile } from "../src/tools/synth"

/** 工具资产 `sound-synth`: a recipe an outside AI writes, rendered by Studio to the same samples every time. */

test("合成测量报告峰值、RMS、削波和三个频段", () => {
  for (const [hz, band] of [[110, "low"], [900, "mid"], [4000, "high"]] as const) {
    const samples = Float32Array.from({ length: SYNTH_RATE }, (_, index) => 0.5 * Math.sin(2 * Math.PI * hz * index / SYNTH_RATE))
    const measured = measureSynth(samples)
    expect(measured).toMatchObject({ seconds: 1, clipped: false, dominant_band: band })
    expect(measured.peak).toBeCloseTo(0.5, 3)
    expect(measured.rms).toBeCloseTo(0.5 / Math.sqrt(2), 4)
  }
  expect(measureSynth(new Float32Array(4096))).toMatchObject({ peak: 0, rms: 0, clipped: false, dominant_band: null })
  expect(measureSynth(Float32Array.of(-1)).clipped).toBe(true)
})

const roar = JSON.stringify({
  seconds: 1.2,
  layers: [
    { wave: "saw", from_hz: 90, to_hz: 55, length: 1.2, gain: 0.8, attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.4, lowpass_hz: 900, vibrato_hz: 7, vibrato_depth: 0.03 },
    { wave: "noise", length: 0.5, gain: 0.4, lowpass_hz: 2000, highpass_hz: 300, release: 0.3 },
  ],
})

test("a recipe renders to the same samples every time, as long as it says, peaking no higher than 0.9", () => {
  const samples = renderSynth(readSynthRecipe(roar))
  expect(samples.length).toBe(Math.round(1.2 * SYNTH_RATE))
  expect(Array.from(renderSynth(readSynthRecipe(roar)).slice(0, 2000))).toEqual(Array.from(samples.slice(0, 2000)))
  let peak = 0
  let energy = 0
  for (const value of samples) {
    peak = Math.max(peak, Math.abs(value))
    energy += value * value
  }
  expect(peak).toBeLessThanOrEqual(0.9 + 1e-6)
  expect(energy / samples.length).toBeGreaterThan(0.001)
  // The envelope's release: the last samples die away.
  expect(Math.abs(samples[samples.length - 1]!)).toBeLessThan(0.01)
})

test("a recipe that is not right is said in plain words", () => {
  expect(() => readSynthRecipe("{ nope")).toThrow("合成配方不是合法的 JSON")
  expect(() => readSynthRecipe(JSON.stringify({ seconds: 1, layers: [{ wave: "sine", start: 2, length: 0.5 }] }))).toThrow("第 1 层在声音结束（1 秒）以后才开始，听不到")
  expect(() => readSynthRecipe(JSON.stringify({ seconds: 30, layers: [{ wave: "sine", length: 1 }] }))).toThrow("合成配方不对")
  expect(() => readSynthRecipe(JSON.stringify({ seconds: 1, layers: [{ wave: "organ", length: 1 }] }))).toThrow("合成配方不对")
})

test("the samples are written as a 16-bit mono WAV file", () => {
  const file = Buffer.from(wavFile(new Float32Array([0, 0.5, -1, 2])))
  expect(file.toString("ascii", 0, 4)).toBe("RIFF")
  expect(file.toString("ascii", 8, 15)).toBe("WAVEfmt")
  expect([file.readUInt16LE(22), file.readUInt32LE(24), file.readUInt16LE(34)]).toEqual([1, SYNTH_RATE, 16])
  expect(file.readUInt32LE(40)).toBe(8)
  expect([file.readInt16LE(44), file.readInt16LE(46), file.readInt16LE(48), file.readInt16LE(50)]).toEqual([0, 16384, -32767, 32767])
})

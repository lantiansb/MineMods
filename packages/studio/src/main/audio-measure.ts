import { execFile } from "node:child_process"
import { encodePng } from "@minemods/mod-core/png"

export const AUDIO_SAMPLE_RATE = 24_000
const WIDTH = 720
const HEIGHT = 154
const FFT = 512
const FLOOR = -100
const GATE = 10 ** (-45 / 20)
const STEP = 240

const db = (value: number) => Number(Math.max(FLOOR, 20 * Math.log10(value)).toFixed(1))
const sec = (frames: number) => Number((frames / AUDIO_SAMPLE_RATE).toFixed(3))

export function decodeAudio(program: string, data: Uint8Array, channels: number, limit: number) {
  return new Promise<Float32Array>((resolve, reject) => {
    const command = ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "ogg", "-i", "pipe:0", "-vn", "-t", String(limit), "-ac", String(channels), "-ar", String(AUDIO_SAMPLE_RATE), "-f", "f32le", "pipe:1"]
    const child = execFile(program, command, { encoding: "buffer", windowsHide: true, timeout: 55_000, maxBuffer: 64 * 1024 * 1024 }, (error, pcm) => {
      if (error || pcm.length < 4 * channels) {
        reject(new Error("这份音频没能解读。请检查保存的文件能不能试听，或在「存储空间」检查转换工具。"))
        return
      }
      const bytes = pcm.byteOffset % 4 ? Uint8Array.from(pcm) : pcm
      resolve(new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4)))
    })
    child.stdin?.on("error", () => {})
    child.stdin?.end(data)
  })
}

export function rmsDb(samples: Float32Array) {
  let sum = 0
  for (const value of samples) sum += value * value
  return db(Math.sqrt(sum / Math.max(1, samples.length)))
}

export function measureAudio(samples: Float32Array, channels: number) {
  const frames = Math.floor(samples.length / channels)
  const high = new Float32Array(WIDTH)
  const low = new Float32Array(WIDTH)
  let peak = 0, sum = 0, start = -1, end = 0, tail = 0
  for (let frame = 0; frame < frames; frame += STEP) {
    const last = Math.min(frames, frame + STEP)
    let power = 0
    for (let i = frame; i < last; i++) {
      const x = Math.min(WIDTH - 1, Math.floor(i * WIDTH / frames))
      for (let channel = 0; channel < channels; channel++) {
        const amplitude = samples[i * channels + channel]!
        const square = amplitude * amplitude
        low[x] = Math.min(low[x]!, amplitude)
        high[x] = Math.max(high[x]!, amplitude)
        peak = Math.max(peak, Math.abs(amplitude))
        power += square
        if (i >= frames - 2 * STEP) tail += square
      }
    }
    if (Math.sqrt(power / ((last - frame) * channels)) >= GATE) {
      if (start === -1) start = frame
      end = last
    }
    sum += power
  }
  return {
    facts: {
      seconds: sec(frames), channels, peak_dbfs: db(peak),
      rms_dbfs: db(Math.sqrt(sum / Math.max(1, frames * channels))),
      starts_seconds: start === -1 ? null : sec(start),
      tail_silence_seconds: sec(frames - end),
      last_20ms_dbfs: db(Math.sqrt(tail / (Math.max(1, Math.min(frames, 2 * STEP)) * channels))),
    },
    high, low, frames, start, end,
  }
}

/** A fixed grid of short windows, sampled uniformly over the recording. Channels contribute power separately. */
export function audioSpectrum(samples: Float32Array, channels: number, frames: number) {
  const re = new Float64Array(FFT), im = new Float64Array(FFT)
  const window = re.map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT - 1)))
  const order = Array.from({ length: FFT }, (_, n) => {
    let result = 0
    for (let i = FFT; i > 1; i >>= 1) { result = (result << 1) | (n & 1); n >>= 1 }
    return result
  })
  const energies = [0, 0, 0]
  const image = new Float32Array(WIDTH * HEIGHT)
  for (let x = 0; x < WIDTH; x++) {
    const from = Math.max(0, Math.min(Math.max(0, frames - FFT), Math.round(x * (frames - 1) / (WIDTH - 1) - FFT / 2)))
    const power = new Float64Array(FFT / 2)
    for (let channel = 0; channel < channels; channel++) {
      for (let i = 0; i < FFT; i++) {
        const n = order[i]!
        re[i] = (samples[(from + n) * channels + channel] ?? 0) * window[n]!
        im[i] = 0
      }
      for (let size = 2; size <= FFT; size *= 2) {
        const half = size / 2
        for (let offset = 0; offset < half; offset++) {
          const angle = -2 * Math.PI * offset / size
          const cosine = Math.cos(angle), sine = Math.sin(angle)
          for (let left = offset; left < FFT; left += size) {
            const right = left + half
            const a = re[right]! * cosine - im[right]! * sine
            const b = im[right]! * cosine + re[right]! * sine
            re[right] = re[left]! - a
            im[right] = im[left]! - b
            re[left] = re[left]! + a
            im[left] = im[left]! + b
          }
        }
      }
      for (let bin = 1; bin < power.length; bin++) power[bin] = power[bin]! + (re[bin]! ** 2 + im[bin]! ** 2)
    }
    for (let bin = 1; bin < power.length; bin++) {
      const hz = bin * AUDIO_SAMPLE_RATE / FFT
      const band = hz < 250 ? 0 : hz < 2000 ? 1 : 2
      energies[band] = energies[band]! + power[bin]!
    }
    for (let row = 0; row < HEIGHT; row++) {
      const bin = Math.min(power.length - 1, Math.round((HEIGHT - row - 1) * (power.length - 1) / (HEIGHT - 1)))
      image[row * WIDTH + x] = Math.sqrt(power[bin]! / channels) / (FFT / 4)
    }
  }
  const total = energies.reduce((sum, value) => sum + value, 0)
  const bands = energies.map((energy) => total ? Math.round(1000 * energy / total) / 10 : 0)
  const dominant = total ? ["低沉", "中频", "偏尖"][energies.indexOf(Math.max(...energies))] : null
  return { image, bands, dominant }
}

type Color = [number, number, number]
const INK: Color = [209, 224, 236]
const GRID: Color = [44, 61, 78]
const SILENCE: Color = [37, 43, 66]
const GLYPHS: Record<string, string[]> = {
  "0": ["111","101","101","101","111"], "1": ["010","110","010","010","111"],
  "2": ["111","001","111","100","111"], "3": ["111","001","111","001","111"],
  "4": ["101","101","111","001","001"], "5": ["111","100","111","001","111"],
  "6": ["111","100","111","101","111"], "7": ["111","001","010","010","010"],
  "8": ["111","101","111","101","111"], "9": ["111","101","111","001","111"],
  ".": ["000","000","000","000","010"], "-": ["000","000","111","000","000"],
  "+": ["000","010","111","010","000"], "s": ["000","011","010","001","110"],
  "k": ["100","101","110","101","101"], "H": ["101","101","111","101","101"],
  "z": ["000","111","010","100","111"], "d": ["001","001","111","101","111"],
  "B": ["110","101","110","101","110"], "F": ["111","100","110","100","100"],
  "S": ["111","100","111","001","111"],
}

export function audioPlot(measured: ReturnType<typeof measureAudio>, spectrum?: Float32Array) {
  const inset = 55, top = 12, width = WIDTH + inset + 8, height = HEIGHT + top + 26
  const pixels = new Uint8Array(width * height * 4)
  const dot = (x: number, y: number, [red, green, blue]: Color) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const at = (y * width + x) * 4
    pixels[at] = red
    pixels[at + 1] = green
    pixels[at + 2] = blue
    pixels[at + 3] = 255
  }
  const text = (value: string, x: number, y: number) => {
    Array.from(value).forEach((letter, index) => GLYPHS[letter]?.forEach((row, j) => Array.from(row).forEach((bit, i) => {
      if (bit === "1") {
        for (let dx = 0; dx < 2; dx++)
          for (let dy = 0; dy < 2; dy++)
            dot(x + index * 8 + i * 2 + dx, y + j * 2 + dy, INK)
      }
    })))
  }
  const first = (Math.max(0, measured.start) / measured.frames) * WIDTH
  const last = (measured.end / measured.frames) * WIDTH
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const chart = x >= inset && x < inset + WIDTH && y >= top && y < top + HEIGHT
      const column = x - inset
      const silence = chart && (measured.start < 0 || column < first || column >= last)
      let color: Color = silence ? SILENCE : [18, 27, 39]
      if (chart && spectrum && !silence) {
        const strength = Math.max(0, Math.min(1, (db(spectrum[(y - top) * WIDTH + column]!) + 75) / 69))
        color = [Math.round(18 + strength * 237), Math.round(27 + strength ** 2 * 175), Math.round(39 + strength * 23)]
      }
      dot(x, y, color)
    }
  }
  const horizontal = spectrum ? ["12kHz", "8kHz", "4kHz", "0Hz"] : ["+1", "0", "-1"]
  for (const [index, value] of horizontal.entries()) {
    const y = top + Math.round(index * (HEIGHT - 1) / (horizontal.length - 1))
    text(value, 4, y - 4)
    for (let x = inset - 4; x < inset + WIDTH; x++) if (x < inset || !spectrum) dot(x, y, GRID)
  }
  for (let index = 0; index <= 6; index++) {
    const x = inset + Math.round(index * (WIDTH - 1) / 6)
    const value = Number((measured.facts.seconds * index / 6).toFixed(measured.facts.seconds < 4 ? 2 : 1)) + "s"
    text(value, Math.min(x, width - value.length * 8), top + HEIGHT + 9)
    if (!spectrum) for (let i = 0; i < HEIGHT; i++) dot(x, top + i, GRID)
  }
  if (!spectrum) {
    for (let column = 0; column < WIDTH; column++) {
      const middle = top + (HEIGHT - 1) / 2
      const y = (value: number) => Math.round(middle - Math.max(-1, Math.min(1, value)) * (HEIGHT - 1) / 2)
      for (let row = y(measured.high[column]!); row <= y(measured.low[column]!); row++) dot(inset + column, row, [105, 219, 180])
    }
  }
  for (const tick of [first, last].filter((value) => value > 0 && value < WIDTH)) {
    for (let row = top; row < top + HEIGHT; row += 3) dot(inset + Math.round(tick), row, [244, 194, 96])
  }
  if (!spectrum) {
    const peak = `${measured.facts.peak_dbfs}dBFS`
    text(peak, width - peak.length * 8 - 12, 2)
  }
  return "data:image/png;base64," + Buffer.from(encodePng(pixels, width, height)).toString("base64")
}

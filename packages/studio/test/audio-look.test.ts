import { expect, test } from "bun:test"
import { audioPlot, audioSpectrum, AUDIO_SAMPLE_RATE, measureAudio } from "../src/main/audio-measure"
import { ExternalAudioLookInputSchema, ExternalTaskLookInputSchema } from "../src/external"

test("单声道录音的起声、尾音、能量和两张看图材料", () => {
  const pcm = Float32Array.from({ length: AUDIO_SAMPLE_RATE }, (_, index) => {
    const time = index / AUDIO_SAMPLE_RATE
    return time >= 0.2 && time < 0.8 ? 0.5 * Math.sin(time * 2 * Math.PI * 100) : 0
  })
  const measured = measureAudio(pcm, 1)
  expect(measured.facts).toMatchObject({
    seconds: 1, channels: 1, peak_dbfs: -6, rms_dbfs: -11.2, starts_seconds: 0.2,
    tail_silence_seconds: 0.2, last_20ms_dbfs: -100,
  })
  const spectrum = audioSpectrum(pcm, 1, measured.frames)
  expect(spectrum.dominant).toBe("低沉")
  expect(spectrum.bands[0]).toBeGreaterThan(95)
  expect(audioPlot(measured)).toStartWith("data:image/png;base64,iVBORw0KGgo")
  expect(audioPlot(measured, spectrum.image)).not.toBe(audioPlot(measured))
})

test("双声道反相不抹掉能量，结尾保有电平", () => {
  const pcm = Float32Array.from({ length: AUDIO_SAMPLE_RATE * 2 }, (_, index) =>
    (index % 2 ? -1 : 1) * 0.4 * Math.sin(Math.floor(index / 2) * 2 * Math.PI * 3500 / AUDIO_SAMPLE_RATE),
  )
  const measured = measureAudio(pcm, 2)
  expect(measured.facts).toMatchObject({ channels: 2, starts_seconds: 0, tail_silence_seconds: 0, last_20ms_dbfs: -11 })
  expect(audioSpectrum(pcm, 2, measured.frames).dominant).toBe("偏尖")
})

test("查看音频和查看任务的参数分别核对", () => {
  const projectId = crypto.randomUUID(), assetId = crypto.randomUUID(), runId = crypto.randomUUID(), taskId = crypto.randomUUID()
  expect(ExternalAudioLookInputSchema.safeParse({ projectId, assetId, audio_part: "loop" }).success).toBe(true)
  expect(ExternalAudioLookInputSchema.safeParse({ projectId, assetId, runId }).success).toBe(false)
  expect(ExternalTaskLookInputSchema.safeParse({ projectId, runId, taskId }).success).toBe(true)
  expect(ExternalTaskLookInputSchema.safeParse({ projectId, runId, taskId, audio_part: 1 }).success).toBe(false)
})

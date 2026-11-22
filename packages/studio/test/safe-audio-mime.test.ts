import { expect, test } from "bun:test"
import { safeAudioMime } from "../src/renderer/features/safe-audio-mime"

const encoded = (header: number[]) => Buffer.from(header).toString("base64")

test("safeAudioMime recognizes common audio signatures when extensions agree", () => {
  expect(safeAudioMime("open.ogg", encoded([79, 103, 103, 83]))).toBe("audio/ogg")
  expect(safeAudioMime("sound.wav", encoded([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]))).toBe("audio/wav")
  expect(safeAudioMime("track.mp3", encoded([73, 68, 51]))).toBe("audio/mpeg")
  expect(safeAudioMime("score.flac", encoded([102, 76, 97, 67]))).toBe("audio/flac")
  expect(safeAudioMime("voice.m4a", encoded([0, 0, 0, 24, 102, 116, 121, 112]))).toBe("audio/mp4")
})

test("safeAudioMime rejects unknown data and mismatched extensions", () => {
  expect(safeAudioMime("open.ogg", encoded([82, 73, 70, 70]))).toBeNull()
  expect(safeAudioMime("image.png", encoded([79, 103, 103, 83]))).toBeNull()
  expect(safeAudioMime("track.mp3", encoded([1, 2, 3]))).toBeNull()
})

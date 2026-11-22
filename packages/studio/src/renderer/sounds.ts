/**
 * 音效, off unless the person turned it on in 个人设置: made on the spot, so no sound file ships and nothing is taken from the game. The audio system is not touched until the first
 * sound that is really wanted. Only what the person did or a real first makes a sound, never a poll or an animation.
 */
export type Sound = "click" | "ding" | "thud"
type Note = { wave: OscillatorType; from: number; to?: number; at?: number; length: number; volume: number }

const NOTES: Record<Sound, Note[]> = {
  click: [{ wave: "square", from: 1400, to: 700, length: 0.03, volume: 0.03 }],
  ding: [
    { wave: "sine", from: 880, length: 0.18, volume: 0.09 },
    { wave: "sine", from: 1320, at: 0.1, length: 0.32, volume: 0.09 },
  ],
  thud: [{ wave: "triangle", from: 170, to: 60, length: 0.16, volume: 0.18 }],
}

const state: { on: boolean; audio: AudioContext | null } = { on: false, audio: null }
export const setSoundSetting = (on: boolean) => {
  state.on = on
}

export function playSound(sound: Sound) {
  if (!state.on) return
  state.audio ??= new AudioContext()
  const audio = state.audio
  if (audio.state === "suspended") void audio.resume()
  for (const note of NOTES[sound]) {
    const start = audio.currentTime + (note.at ?? 0)
    const tone = audio.createOscillator()
    const level = audio.createGain()
    tone.type = note.wave
    tone.frequency.setValueAtTime(note.from, start)
    if (note.to) tone.frequency.exponentialRampToValueAtTime(note.to, start + note.length)
    level.gain.setValueAtTime(note.volume, start)
    level.gain.exponentialRampToValueAtTime(0.0001, start + note.length)
    tone.connect(level).connect(audio.destination)
    tone.start(start)
    tone.stop(start + note.length)
  }
}

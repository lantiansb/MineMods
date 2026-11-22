export function safeAudioMime(path: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64.slice(0, 32)), (character) => character.charCodeAt(0))
  const ascii = String.fromCharCode(...bytes)
  const extension = path.toLowerCase().split(".").at(-1)
  if (ascii.startsWith("OggS") && extension === "ogg") return "audio/ogg"
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE" && extension === "wav") return "audio/wav"
  if (ascii.startsWith("fLaC") && extension === "flac") return "audio/flac"
  if (ascii.slice(4, 8) === "ftyp" && ["m4a", "mp4"].includes(extension ?? "")) return "audio/mp4"
  if (extension === "mp3" && (ascii.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)))
    return "audio/mpeg"
  return null
}

import { oggChecksum } from "../src/sound"

/**
 * An Ogg Vorbis file built by hand for tests: real Ogg pages (with their checksums), the three Vorbis headers and one
 * page of "sound" whose last sample position says how long it is. Its setup header is not a real codebook, so no player
 * decodes it; it is what `oggVorbisFacts` reads (the structure), which is what these tests are about. A real Vorbis
 * file is read where the machine has the game's own sounds (`MINECRAFT_SOUNDS` in the tests).
 */
export function oggVorbis(options: { channels?: number; rate?: number; samples?: number; serial?: number; padding?: number } = {}) {
  const { channels = 1, rate = 44100, samples = rate, serial = 0x5eed, padding = 0 } = options
  const ident = new Uint8Array(30)
  ident.set([1, ...ascii("vorbis")])
  const view = new DataView(ident.buffer)
  view.setUint32(7, 0, true)
  ident[11] = channels
  view.setUint32(12, rate, true)
  view.setInt32(20, 96000, true)
  ident[28] = 0xb8
  ident[29] = 1
  const comment = new Uint8Array([3, ...ascii("vorbis"), 0, 0, 0, 0, 0, 0, 0, 0, 1])
  const setup = new Uint8Array([5, ...ascii("vorbis"), ...Array.from({ length: 20 }, () => 0)])
  // The "sound": 32 bytes and `padding` more, a packet of at most 60 000 bytes a page (a page holds at most 255 × 255).
  const chunks = Math.max(1, Math.ceil((32 + padding) / 60_000))
  const sound = Array.from({ length: chunks }, (_, index) => new Uint8Array(Math.min(60_000, 32 + padding - index * 60_000)).fill(0x55))
  return concat([page(serial, 0, 0x02, 0, [ident]), page(serial, 1, 0, 0, [comment, setup]), ...sound.map((packet, index) => page(serial, 2 + index, index === chunks - 1 ? 0x04 : 0, Math.round((samples * (index + 1)) / chunks), [packet]))])
}

/** One Ogg page holding these packets, each ending inside it. */
export function page(serial: number, sequence: number, flags: number, granule: number, packets: Uint8Array[]) {
  const lacing = packets.flatMap((packet) => [...Array.from({ length: Math.floor(packet.length / 255) }, () => 255), packet.length % 255])
  const body = concat(packets)
  const bytes = new Uint8Array(27 + lacing.length + body.length)
  const view = new DataView(bytes.buffer)
  bytes.set(ascii("OggS"))
  bytes[4] = 0
  bytes[5] = flags
  view.setBigInt64(6, BigInt(granule), true)
  view.setUint32(14, serial, true)
  view.setUint32(18, sequence, true)
  bytes[26] = lacing.length
  bytes.set(lacing, 27)
  bytes.set(body, 27 + lacing.length)
  view.setUint32(22, oggChecksum(bytes), true)
  return bytes
}

export const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0))
export const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  parts.reduce((at, part) => (out.set(part, at), at + part.length), 0)
  return out
}
/** As a document holds it. */
export const oggDataUrl = (bytes: Uint8Array) => `data:audio/ogg;base64,${Buffer.from(bytes).toString("base64")}`

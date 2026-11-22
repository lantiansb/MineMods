import { zlibSync } from "fflate"

export function previewPng(pixels: Uint8Array, width: number, height = width) {
  const rows = new Uint8Array(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) rows.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  const chunk = (type: string, data: Uint8Array) => {
    const body = Uint8Array.from([...type].map((letter) => letter.charCodeAt(0)).concat([...data]))
    const crc = body.reduce((value, byte) => {
      let next = value ^ byte
      for (let bit = 0; bit < 8; bit++) next = (next >>> 1) ^ (next & 1 ? 0xedb88320 : 0)
      return next
    }, 0xffffffff)
    const word = (value: number) => [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]
    return [...word(data.length), ...body, ...word((crc ^ 0xffffffff) >>> 0)]
  }
  return Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk("IHDR", Uint8Array.from([0, 0, width >>> 8, width & 255, 0, 0, height >>> 8, height & 255, 8, 6, 0, 0, 0])),
    ...chunk("IDAT", zlibSync(rows)),
    ...chunk("IEND", new Uint8Array()),
  ])
}

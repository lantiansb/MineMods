import { deflateSync } from "node:zlib"

function chunk(type: string, data: Uint8Array) {
  const output = Buffer.alloc(data.length + 12)
  output.writeUInt32BE(data.length)
  output.write(type, 4, "ascii")
  output.set(data, 8)
  let crc = 0xffffffff
  output.subarray(4, data.length + 8).forEach((value) => {
    crc ^= value
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  })
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8)
  return output
}

export function encodePng(pixels: Uint8Array, width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096
  )
    throw new Error("Invalid texture dimensions")
  if (pixels.length !== width * height * 4) throw new Error("Texture pixel count does not match dimensions")
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const rows = Buffer.alloc(height * (width * 4 + 1))
  for (let row = 0; row < height; row++)
    rows.set(pixels.subarray(row * width * 4, (row + 1) * width * 4), row * (width * 4 + 1) + 1)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", new Uint8Array()),
  ])
}

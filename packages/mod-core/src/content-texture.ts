const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const read32 = (bytes: Uint8Array, offset: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)
function crc32(bytes: Uint8Array) {
  return (bytes.reduce((crc, value) => {
    let next = (crc ^ value) >>> 0
    for (let bit = 0; bit < 8; bit += 1) next = (next >>> 1) ^ (next & 1 ? 0xedb88320 : 0)
    return next >>> 0
  }, 0xffffffff) ^ 0xffffffff) >>> 0
}
export function decodeTextureDataUrl(value: string) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value)
  if (!match) throw new Error("纹理必须是 PNG data URL。")
  const bytes = Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0))
  if (bytes.length > 1024 * 1024 || !PNG.every((value, index) => bytes[index] === value)) throw new Error("纹理 PNG 无效或超过 1 MB。")
  let offset = 8; let seenHeader = false; let seenData = false; let ended = false
  while (offset + 12 <= bytes.length) {
    const length = read32(bytes, offset); const type = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8)); const end = offset + 12 + length
    if (end > bytes.length) throw new Error("纹理 PNG 数据不完整。")
    const chunk = bytes.slice(offset + 4, offset + 8 + length)
    if (read32(bytes, end - 4) !== crc32(chunk)) throw new Error("纹理 PNG 校验失败。")
    if (type === "IHDR") {
      const width = read32(bytes, offset + 8); const height = read32(bytes, offset + 12); const bitDepth = bytes[offset + 16]; const colorType = bytes[offset + 17]
      const validDepth = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[colorType as 0 | 2 | 3 | 4 | 6]?.includes(bitDepth)
      if (offset !== 8 || length !== 13 || seenHeader || width < 1 || height < 1 || width > 1024 || height > 1024 || !validDepth || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) throw new Error("纹理 PNG IHDR 无效，尺寸最大支持 1024×1024。")
      seenHeader = true
    }
    if (type === "IDAT") seenData = true
    if (type === "IEND") { if (length !== 0) throw new Error("纹理 PNG IEND 无效。"); ended = true; offset = end; break }
    offset = end
  }
  if (!seenHeader || !seenData || !ended || offset !== bytes.length) throw new Error("纹理 PNG 缺少必要区块或包含尾随数据。")
  return bytes
}

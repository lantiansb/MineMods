/**
 * 「换一张图」: a picture file the person chose, checked and turned into what a block or an item stores for its
 * picture (a PNG data URL, the same form an AI's picture is saved in). It is the person's own decision: it is
 * not looked at, measured or reviewed, only held to what the game can show.
 * No Node APIs.
 */
import { decodeTextureDataUrl } from "@minemods/mod-core/content-texture"

// The game's own blocks and items are 16×16; a picture of another size would stand out beside every one of them.
export const PICTURE_SIDE = 16
export const PICTURE_WORDS = {
  accepted: `只收 ${PICTURE_SIDE}×${PICTURE_SIDE} 的 PNG 图片：Minecraft 自己的方块和物品都是这个大小。`,
  notPng: "这不是一张 PNG 图片。",
  broken: "这张 PNG 读不出来，可能文件坏了。用画图软件重新导出一次再试。",
  size: (width: number, height: number) => `这张图是 ${width}×${height} 的。`,
  // A block's further pictures (`variants`) must be the size of its first (`validateContent`).
  others: (count: number, width: number, height: number) => `这个方块还带着另外 ${count} 张 ${width}×${height} 的随机图案，几张图要一样大，所以这里要换成 ${width}×${height} 的 PNG。`,
} as const

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const encode = (bytes: Uint8Array) => `data:image/png;base64,${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`

/** The width and height a PNG's header states, or null when the bytes are no PNG. */
export function pictureSize(bytes: Uint8Array) {
  if (bytes.length < 24 || !SIGNATURE.every((value, index) => bytes[index] === value)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** The size of a stored picture (a PNG data URL), or null when it cannot be read. */
export function storedSize(url: string) {
  try {
    return pictureSize(decodeTextureDataUrl(url))
  } catch {
    return null
  }
}

/**
 * A chosen file as a stored picture, or one plain sentence saying why not and what is taken.
 * `beside`: the block's further pictures, which the new one has to match in size.
 */
export function importPicture(bytes: Uint8Array, beside: readonly string[] = []): { ok: true; url: string } | { ok: false; text: string } {
  const size = pictureSize(bytes)
  if (!size) return { ok: false, text: `${PICTURE_WORDS.notPng}${PICTURE_WORDS.accepted}` }
  const other = beside.map(storedSize).find((value) => value !== null)
  const need = other ?? { width: PICTURE_SIDE, height: PICTURE_SIDE }
  if (size.width !== need.width || size.height !== need.height)
    return { ok: false, text: `${PICTURE_WORDS.size(size.width, size.height)}${other && (other.width !== PICTURE_SIDE || other.height !== PICTURE_SIDE) ? PICTURE_WORDS.others(beside.length, other.width, other.height) : PICTURE_WORDS.accepted}` }
  const url = encode(bytes)
  try {
    // The very check a save and a build make of a stored picture.
    decodeTextureDataUrl(url)
  } catch {
    return { ok: false, text: PICTURE_WORDS.broken }
  }
  return { ok: true, url }
}

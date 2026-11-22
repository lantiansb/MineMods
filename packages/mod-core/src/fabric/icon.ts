import { encodePng } from "../png"
import { decodeRgbaPng } from "../png-decode"
import { GIVEN_ICON, ICON_URL_PREFIX, ICON_WORDS, iconSizeProblem, pngSize } from "../release"

/**
 * The picture a mod list shows beside the mod, made from one of the mod's own item or block pictures.
 * `size`: the game's item and block pictures are 16 pixels a side. `scale`: 8, because mod lists draw
 * the icon at 32 to 64 pixels and Fabric's own example mod ships a 128-pixel icon (16 × 8 = 128); each
 * pixel becomes a square of 8 × 8 so the picture stays as sharp as it is in the game.
 */
export const MOD_ICON = { size: 16, scale: 8, file: "icon.png" } as const

/** Null for a picture that is not 16 × 16 or cannot be read: such a mod simply has no icon. */
export function modIcon(png: Uint8Array) {
  const image = (() => {
    try {
      return decodeRgbaPng(png)
    } catch {
      return null
    }
  })()
  if (!image || image.width !== MOD_ICON.size || image.height !== MOD_ICON.size) return null
  const side = MOD_ICON.size * MOD_ICON.scale
  const pixels = new Uint8Array(side * side * 4)
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const from = (Math.floor(y / MOD_ICON.scale) * MOD_ICON.size + Math.floor(x / MOD_ICON.scale)) * 4
      pixels.set(image.pixels.subarray(from, from + 4), (y * side + x) * 4)
    }
  return encodePng(pixels, side, side)
}

export type GivenIcon = { ok: true; png: Uint8Array; side: number; scaled: boolean } | { ok: false; text: string }

/**
 * A picture the person gave, as the PNG the jar carries: a square of 16, 32 or 64 pixels is enlarged by a whole
 * number of steps to 128 (every pixel a block, so pixel art stays sharp), a square of 128 to 512 is kept as it is,
 * and anything else is refused with the reason in words.
 */
export function givenIcon(png: Uint8Array): GivenIcon {
  if (png.length > GIVEN_ICON.maxBytes) return { ok: false, text: ICON_WORDS.tooBig }
  // The size is read from the header first, so a huge or odd-shaped picture is told its size instead of "unreadable".
  const size = pngSize(png)
  if (!size) return { ok: false, text: ICON_WORDS.unreadable }
  const problem = iconSizeProblem(size.width, size.height)
  if (problem) return { ok: false, text: problem }
  const side = size.width
  const keep = side >= GIVEN_ICON.shown
  const image = (() => {
    try {
      return decodeRgbaPng(png, { side: GIVEN_ICON.largest })
    } catch {
      return null
    }
  })()
  if (!image || image.width !== side || image.height !== side) return { ok: false, text: ICON_WORDS.unreadable }
  if (keep) return { ok: true, png, side, scaled: false }
  const scale = GIVEN_ICON.shown / side
  const pixels = new Uint8Array(GIVEN_ICON.shown * GIVEN_ICON.shown * 4)
  for (let y = 0; y < GIVEN_ICON.shown; y++)
    for (let x = 0; x < GIVEN_ICON.shown; x++) {
      const from = (Math.floor(y / scale) * side + Math.floor(x / scale)) * 4
      pixels.set(image.pixels.subarray(from, from + 4), (y * GIVEN_ICON.shown + x) * 4)
    }
  return { ok: true, png: encodePng(pixels, GIVEN_ICON.shown, GIVEN_ICON.shown), side, scaled: true }
}

/** The data URL a project keeps a given icon as: the same form its item and block pictures are kept in. */
export const iconUrl = (png: Uint8Array) => `${ICON_URL_PREFIX}${Buffer.from(png).toString("base64")}`
/** The PNG bytes of a stored icon; null for anything that is not one of Studio's own icon URLs. */
export const iconBytes = (url: string | null | undefined) => (url?.startsWith(ICON_URL_PREFIX) ? new Uint8Array(Buffer.from(url.slice(ICON_URL_PREFIX.length), "base64")) : null)

import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { TICKS } from "./ability-words"
import { abilityPlace } from "./creature-abilities"
import { decodeRgbaPng } from "./png-decode"
import { encodePng } from "./png"
import { bonesBelow } from "./boss-bones"
import type { shakeCurve } from "./boss-look-words"

/**
 * Boss 能力 8 and 10 as pictures a reviewer reads (the app's look draws them, `studio/src/main/look-job.ts`): a boss's model in a stage of its fight (its compiled
 * geometry with the hidden bones' faces turned off, its texture with its own glowing parts added at the stage's brightness), the ring a shake reaches, and a shake's
 * strength over time. The numbers are the ones the generated Java runs on (`bossLookPlan`, `shakeCurve`).
 */

type Vector = [number, number, number]
type Geometry = { "minecraft:geometry": { bones: { name: string; cubes?: { uv?: Record<string, { visible?: boolean }> }[] }[] }[] }

/** A bone and every bone that hangs from it, by name. */
export { bonesBelow } from "./boss-bones"

/** The compiled geometry with every face of `hidden` (and of what hangs from them) turned off, as GeckoLib hides a bone with its children. A copy: the one given is not changed. */
export function hiddenGeometry<T>(geometry: T, design: Pick<ModelDesign, "bones">, hidden: readonly string[]): T {
  const gone = bonesBelow(design, hidden)
  const copy = structuredClone(geometry) as unknown as Geometry
  for (const bone of copy["minecraft:geometry"][0]?.bones ?? [])
    if (gone.has(bone.name)) for (const cube of bone.cubes ?? []) for (const face of Object.values(cube.uv ?? {})) face.visible = false
  return copy as unknown as T
}

/** The texture with a glow mask added on top at `level` (0 to 1), as the game adds a glowing layer at full brightness: where the mask is bright, the picture is brighter. */
export function glowingTexture(texture: Uint8Array, mask: Uint8Array | null, level: number) {
  if (!mask || level <= 0) return texture
  const base = decodeRgbaPng(texture)
  const glow = decodeRgbaPng(mask)
  if (base.width !== glow.width || base.height !== glow.height) return texture
  const pixels = new Uint8Array(base.pixels)
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = glow.pixels[index + 3]! / 255
    for (let channel = 0; channel < 3; channel++) pixels[index + channel] = Math.min(255, Math.round(pixels[index + channel]! + glow.pixels[index + channel]! * alpha * level))
  }
  return encodePng(pixels, base.width, base.height)
}

/** A thin ring on the ground, `radius` blocks round the creature's feet, as flat faces in the look's space (model pixels): where a shake reaches. */
export function ringFaces(radius: number, width = 0.15, segments = 48): Vector[][] {
  return Array.from({ length: segments }, (_, index) => {
    const at = (step: number, reach: number): Vector => abilityPlace(reach * Math.cos((step * 2 * Math.PI) / segments), 0.02, reach * Math.sin((step * 2 * Math.PI) / segments))
    return [at(index, radius - width), at(index, radius), at(index + 1, radius), at(index + 1, radius - width)]
  })
}

const COLOURS: readonly (readonly [number, number, number])[] = [
  [96, 170, 255],
  [255, 196, 64],
  [120, 220, 140],
  [230, 120, 230],
]

/**
 * A shake's strength at its centre over time as a picture `width` × `height`: each shake in its own colour, their sum in white, the cap as a red line; a grey line every
 * second and at every whole unit of strength. What the picture's label has to say (its scales) is returned beside it.
 */
export function shakeCurvePicture(curve: NonNullable<ReturnType<typeof shakeCurve>>, width = 480, height = 240) {
  const pixels = new Uint8Array(width * height * 4)
  const left = 8
  const bottom = height - 8
  const top = Math.max(curve.cap, curve.peak.sum) * 1.1
  const x = (tick: number) => left + Math.round(((width - left - 8) * tick) / Math.max(1, curve.end))
  const y = (value: number) => bottom - Math.round(((bottom - 8) * value) / top)
  const dot = (px: number, py: number, colour: readonly [number, number, number]) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return
    pixels.set([colour[0], colour[1], colour[2], 255], (py * width + px) * 4)
  }
  const line = (x0: number, y0: number, x1: number, y1: number, colour: readonly [number, number, number], thick = 1) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let step = 0; step <= steps; step++) {
      const px = Math.round(x0 + ((x1 - x0) * step) / steps)
      const py = Math.round(y0 + ((y1 - y0) * step) / steps)
      for (let dx = 0; dx < thick; dx++) for (let dy = 0; dy < thick; dy++) dot(px + dx, py + dy, colour)
    }
  }
  for (let index = 0; index < pixels.length; index += 4) pixels.set([24, 26, 30, 255], index)
  for (let second = 0; second * TICKS <= curve.end; second++) line(x(second * TICKS), 8, x(second * TICKS), bottom, [60, 64, 72])
  for (let unit = 1; unit < top; unit++) line(left, y(unit), width - 8, y(unit), [60, 64, 72])
  line(left, bottom, width - 8, bottom, [140, 140, 150])
  line(left, 8, left, bottom, [140, 140, 150])
  line(left, y(curve.cap), width - 8, y(curve.cap), [230, 60, 60], 2)
  curve.points.slice(1).forEach((point, index) => {
    const before = curve.points[index]!
    point.each.forEach((value, shake) => line(x(before.tick), y(before.each[shake]!), x(point.tick), y(value), COLOURS[shake % COLOURS.length]!))
    line(x(before.tick), y(before.sum), x(point.tick), y(point.sum), [245, 245, 245], 2)
  })
  return { png: encodePng(pixels, width, height), seconds: Number((curve.end / TICKS).toFixed(2)), top: Number(top.toFixed(2)) }
}

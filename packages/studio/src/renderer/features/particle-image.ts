import { appearancePixels, type ParticleDocument } from "@minemods/mod-core/particle"

export function particleSource(doc: ParticleDocument) {
  const count = doc.frames.filter((f) => typeof f !== "string").length
  return count === 0 ? "自绘贴图" : count === doc.frames.length ? "自带形状" : "混合贴图"
}

export function particleImage(frame: ParticleDocument["frames"][number], tint?: string, edge?: "soft") {
  if (typeof frame === "string" && !tint && !edge) return frame
  const { width, pixels } = appearancePixels(frame,edge)
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = width
  const context = canvas.getContext("2d")!
  const image = context.createImageData(width, width)
  image.data.set(pixels)
  if (tint)
    for (let c = 0; c < 3; c++) {
      const channel = parseInt(tint.slice(1 + c * 2, 3 + c * 2), 16) / 255
      for (let i = c; i < pixels.length; i += 4) image.data[i] = pixels[i]! * channel
    }
  context.putImageData(image, 0, 0)
  return canvas.toDataURL("image/png")
}

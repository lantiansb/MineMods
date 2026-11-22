import type { AnnotationMark } from "@minemods/studio-ai/model-annotation"

export type AnnotationPoint = { x: number; y: number }

export function annotationPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): AnnotationPoint {
  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height))),
  }
}

export function annotationBox(start: AnnotationPoint, end: AnnotationPoint) {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
}

export function annotationSourceMatches(snapshot: { sourceKey: string; projectRevision: number }, sourceKey: string, projectRevision: number) {
  return snapshot.sourceKey === sourceKey && snapshot.projectRevision === projectRevision
}

export function annotationArrow(start: AnnotationPoint, end: AnnotationPoint, width: number, height: number) {
  const x = end.x * width
  const y = end.y * height
  const angle = Math.atan2((end.y - start.y) * height, (end.x - start.x) * width)
  const size = Math.min(Math.max(10, width * 0.018), Math.hypot((end.x - start.x) * width, (end.y - start.y) * height) * 0.45)
  return `M ${start.x * width} ${start.y * height} L ${x} ${y} M ${x - size * Math.cos(angle - Math.PI / 6)} ${y - size * Math.sin(angle - Math.PI / 6)} L ${x} ${y} L ${x - size * Math.cos(angle + Math.PI / 6)} ${y - size * Math.sin(angle + Math.PI / 6)}`
}

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;")

/** The same SVG is used for the editor and raster export, so the AI sees the marks the person drew. */
export function annotationLayers(marks: readonly AnnotationMark[], width: number, height: number) {
  const stroke = Math.max(2, width * 0.003)
  const font = Math.max(14, width * 0.022)
  return marks.map((mark, index) => {
    const end = mark.end ?? mark.start
    const box = annotationBox(mark.start, end)
    const shape = mark.kind === "circle"
      ? `<ellipse cx="${(box.x + box.width / 2) * width}" cy="${(box.y + box.height / 2) * height}" rx="${box.width * width / 2}" ry="${box.height * height / 2}"/>`
      : mark.kind === "arrow" ? `<path d="${annotationArrow(mark.start, end, width, height)}"/>` : ""
    const count = Math.max(1, Math.floor(width * 0.65 / font))
    const lines = (mark.kind === "text" ? mark.text ?? "" : String(mark.note ?? index + 1)).split("\n").flatMap((line) => {
      const chars = Array.from(line)
      return Array.from({ length: Math.max(1, Math.ceil(chars.length / count)) }, (_, row) => chars.slice(row * count, (row + 1) * count).join(""))
    })
    const x = Math.max(2, Math.min(width - Math.max(...lines.map((line) => Array.from(line).length)) * font - 4, mark.start.x * width))
    const y = Math.max(font, Math.min(height - font * (1 + (lines.length - 1) * 1.3), mark.start.y * height))
    const text = `<text x="${x}" y="${y}" font-family="sans-serif" font-size="${font}" font-weight="600" fill="#ff654f" stroke="#17191f" stroke-width="${stroke}" paint-order="stroke">${lines.map((line, row) => `<tspan x="${x}" dy="${row ? font * 1.3 : 0}">${escape(line)}</tspan>`).join("")}</text>`
    return `<g fill="none" stroke="#ff654f" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${shape}</g>${text}`
  }).join("")
}

export function annotationSvg(marks: readonly AnnotationMark[], width: number, height: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${annotationLayers(marks, width, height)}</svg>`
}

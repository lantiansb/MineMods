import * as THREE from "three"
import { modelBounds } from "@minemods/mod-core/model-bounds"
import { hitboxAppearance } from "@minemods/mod-core/creature-hitbox"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { HITBOX_FAULT_MARK } from "@minemods/studio-ai/making"
import type { LookCell, LookJob, LookPart, LookPictures, LookScene, LookSheet } from "../main/look-job"
import { CAPTION, captionBand, captionLayout, pictureSize } from "./look-caption"
import { lookCamera, projector } from "./look-camera"
import { drawFlat } from "./look-flat"
import { mountViewport, type Preview } from "./viewport"
import "./themes.css"

/**
 * The page behind "looking". It lives in a window that is never shown and never focused; the main
 * process hands it a job and it answers with contact sheets as JPEG data URLs. Every model cell is drawn
 * by the app's own viewport (`mountViewport`), so what an AI is shown is what a person sees in Studio.
 * Flat pictures (a block's face, an item's icon) are drawn by `look-flat.ts` on the same sheet.
 * Nothing here decides what to draw: `main/look-job.ts` does.
 */

type Vector = [number, number, number]
type ViewCell = Extract<LookCell, { kind: "view" }>
type BoxesCell = Extract<LookCell, { kind: "boxes" }>
// A hit's red overlay; collision boxes use the shared damage-scale palette (hitboxAppearance).
const SHAPE_COLOURS = { hit: { fill: "#ff4030", stroke: "rgb(200, 24, 16)" } } as const

// A window nobody sees may never be asked for a frame, and never be told its size changed. The viewport
// asks for both, so here frames are run by hand and a size is reported the moment it is asked about.
const frames: FrameRequestCallback[] = []
window.requestAnimationFrame = (callback) => frames.push(callback)
window.cancelAnimationFrame = () => void frames.splice(0)
window.ResizeObserver = class {
  constructor(private readonly changed: ResizeObserverCallback) {}
  observe() {
    this.changed([], this)
  }
  unobserve() {}
  disconnect() {}
}
// A texture read once is handed to the viewport on the very next timer, so one timer later it is on the model.
THREE.Cache.enabled = true
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const BACKGROUND = "#8fb7e8"
// How far two pixels of the same spot must differ (red, green and blue added up, of 765) to count as changed: above what drawing the same pose twice can differ by.
const CHANGED = 36

/** The box around a part and everything that hangs from it, or around the whole model. Null when there is nothing to frame. */
function boxOf(design: ModelDesign, part?: string, alone = false) {
  const under = (name: string): string[] => [name, ...(alone ? [] : design.bones.filter((bone) => bone.parent === name).flatMap((bone) => under(bone.name)))]
  const kept = part === undefined ? null : under(part)
  const bounds = modelBounds(kept ? ({ ...design, bones: design.bones.map((bone) => (kept.includes(bone.name) ? bone : { ...bone, cubes: [] })) } as ModelDesign) : design)
  return [...bounds.min, ...bounds.max].every(Number.isFinite) ? { min: bounds.min as Vector, max: bounds.max as Vector } : null
}

function placed(design: ModelDesign, cell: ViewCell, aspect: number) {
  return lookCamera(boxOf(design, cell.focus) ?? boxOf(design) ?? { min: [-1, 0, -1] as Vector, max: [1, 2, 1] as Vector }, cell.view, aspect)
}

/** Draw one cell with the app's viewport into the sheet. The viewport's canvas is read in the same breath it is drawn in. */
async function shoot(sheet: CanvasRenderingContext2D, scene: LookScene, cell: ViewCell, at: [number, number], size: [number, number], alone = false, scenes: LookScene[] = []) {
  const host = document.createElement("div")
  host.style.cssText = `position:fixed;left:0;top:0;width:${size[0]}px;height:${size[1]}px;pointer-events:none`
  document.body.append(host)
  const camera = cell.camera ?? placed(scene.design, cell, size[0] / size[1])
  // Further scenes of the cell hang in the same view at their own offsets. A texture read once is handed to the viewport on the very next timer, so every one is read first.
  const parts = (cell.extra ?? []).map((part) => ({ scene: scenes[part.scene]!, offset: part.offset }))
  await [scene, ...parts.map((part) => part.scene)].reduce(async (before, value) => {
    await before
    if (value.preview) await new THREE.ImageLoader().loadAsync(value.preview.textureDataUrl)
  }, Promise.resolve())
  // A cell that is not a moment of a motion shows the pose the model is built in.
  const viewport = mountViewport(host, cell.animation === undefined ? { ...scene.design, animations: [] } : scene.design, scene.preview as Preview | null, () => undefined, {
    camera,
    time: cell.time ?? 0,
    animation: cell.animation,
    playing: false,
    ...(cell.offset ? { offset: cell.offset } : {}),
    ...(parts.length ? { parts: parts.map((part) => ({ design: part.scene.design, preview: part.scene.preview as Preview | null, offset: part.offset })) } : {}),
    // `alone`: the thing by itself on nothing (the viewport's icon mode: no sky, no ground, no grid), to know which pixels are the thing.
    ...(alone ? { icon: true } : {}),
  })
  await turn()
  frames.splice(0).forEach((frame) => frame(performance.now()))
  const canvas = host.querySelector("canvas")
  if (canvas) sheet.drawImage(canvas, 0, 0, canvas.width, canvas.height, at[0], at[1], size[0], size[1])
  if (cell.names) named(sheet, scene.design, camera, at, size)
  viewport.dispose()
  // Browsers keep only so many 3D contexts alive; this one is done.
  canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext()
  host.remove()
  if (!canvas) throw new Error("no canvas")
}

/**
 * Two moments of a motion laid over each other: the later one drawn pale and grey, and every pixel that
 * differs between the two tinted magenta and counted. A motion too small to spot between two stills side
 * by side shows here as an outline of what it moves; a motion that changes nothing shows as nothing.
 */
async function compared(sheet: CanvasRenderingContext2D, scene: LookScene, cell: Extract<LookCell, { kind: "compare" }>, at: [number, number], size: [number, number]) {
  // What the tint means and how much of it there is, then the measured facts, in a band under the picture. The picture is drawn above the band (`pictureSize`),
  // so the band is laid out first; the count in its first line is not known yet, so the room is made for the longest it can be said (every pixel changed), which is never fewer rows than the real one.
  sheet.font = "600 15px sans-serif"
  sheet.textBaseline = "middle"
  const laying = (heading: string) => captionLayout([heading, ...cell.caption], size[0] - 20, size[1], (text) => sheet.measureText(text).width)
  const rows = laying(`洋红色是变了的地方：${size[0] * size[1]} 个像素（这一格的 100.0%）`).length
  const area = pictureSize(size, rows)
  const [first, second] = await cell.times.reduce<Promise<ImageData[]>>(async (before, time) => {
    const done = await before
    const canvas = document.createElement("canvas")
    canvas.width = area[0]
    canvas.height = area[1]
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) throw new Error("no 2d canvas")
    await shoot(context, scene, { kind: "view", label: "", scene: cell.scene, view: cell.view, animation: cell.animation, time, ...(cell.camera ? { camera: cell.camera } : {}) }, [0, 0], area)
    return [...done, context.getImageData(0, 0, area[0], area[1])]
  }, Promise.resolve([]))
  const laid = new ImageData(area[0], area[1])
  const changed = Array.from({ length: area[0] * area[1] }, (_, pixel) => pixel * 4).filter((offset) => {
    const differs = [0, 1, 2].reduce((sum, channel) => sum + Math.abs(first!.data[offset + channel]! - second!.data[offset + channel]!), 0) > CHANGED
    const grey = 120 + (second!.data[offset]! * 0.3 + second!.data[offset + 1]! * 0.59 + second!.data[offset + 2]! * 0.11) * 0.5
    laid.data.set(differs ? [255, 0, 200, 255] : [grey, grey, grey, 255], offset)
    return differs
  }).length
  sheet.putImageData(laid, at[0], at[1])
  sheet.font = "600 15px sans-serif"
  sheet.textBaseline = "middle"
  const lines = laying(changed ? `洋红色是变了的地方：${changed} 个像素（这一格的 ${((changed * 100) / (area[0] * area[1])).toFixed(changed * 1000 < area[0] * area[1] ? 2 : 1)}%）` : "这两刻之间一个像素都没有变")
  // The band is as tall as the room made for it, so no strip of the cell is left between the picture and the band; its rows sit at its foot.
  sheet.fillStyle = "rgba(20, 20, 20, 0.82)"
  sheet.fillRect(at[0], at[1] + size[1] - captionBand(Math.max(rows, lines.length)), size[0], captionBand(Math.max(rows, lines.length)))
  lines.forEach((line, index) => {
    sheet.fillStyle = line.sentence === 0 && changed ? "#ff7fe0" : "#ffffff"
    sheet.fillText(line.text, at[0] + 10, at[1] + size[1] - (lines.length - index) * CAPTION.row + 7)
  })
}

/**
 * H3: one moment drawn in layers, for effects that let the world show through. The first scene is drawn
 * solid. Every next one holds what is under it plus some effects: where it differs from the scene before,
 * it is mixed in only as strongly as its `alpha` says, so what stands behind those effects still shows.
 */
async function layered(scenes: LookScene[], moment: ViewCell, over: { scene: number; alpha: number; extra?: LookPart[] }[], size: [number, number]) {
  // `layer`: what is drawn on top of the moment's own scene, if anything: the layer's own scene and the further scenes hanging in its view.
  const taken = async (layer?: { scene: number; extra?: LookPart[] }) => {
    const canvas = document.createElement("canvas")
    canvas.width = size[0]
    canvas.height = size[1]
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) throw new Error("no 2d canvas")
    const drawn = layer ? { ...moment, scene: layer.scene, extra: layer.extra } : moment
    await shoot(context, scenes[drawn.scene]!, drawn, [0, 0], size, false, scenes)
    return context.getImageData(0, 0, size[0], size[1])
  }
  const mixed = await taken()
  await over.reduce(async (before, layer) => {
    const under = await before
    const next = await taken(layer)
    Array.from({ length: size[0] * size[1] }, (_, pixel) => pixel * 4)
      .filter((offset) => [0, 1, 2].reduce((sum, channel) => sum + Math.abs(next.data[offset + channel]! - under.data[offset + channel]!), 0) > CHANGED)
      .forEach((offset) => [0, 1, 2].forEach((channel) => (mixed.data[offset + channel] = mixed.data[offset + channel]! + (next.data[offset + channel]! - mixed.data[offset + channel]!) * layer.alpha)))
    return next
  }, Promise.resolve(new ImageData(new Uint8ClampedArray(mixed.data), size[0], size[1])))
  return mixed
}

/**
 * Engineer G2: a moment of a motion with where an ability's hit lands drawn over it.
 * Round 10: the shape no longer tints what it covers. A see-through red over the whole shape turned the
 * creature inside it pink, and a reviewer could not judge its colours. Now the creature (and any effect) is
 * drawn once more by itself on nothing to learn which pixels are it, and those pixels are left alone: around
 * them the shape is a faint fill, where it falls on the ground a stronger one, and its outline runs over
 * everything, thinner across the creature. What matters is where the shape is; the creature keeps its own colours.
 */
async function hit(sheet: CanvasRenderingContext2D, scene: LookScene, cell: Extract<LookCell, { kind: "hit" }> | BoxesCell, at: [number, number], size: [number, number], scenes: LookScene[] = []) {
  // `offset` and `extra` (hit cells only): where the cell's own scene stands, and the further scenes that hang in the same view (effects, each at its own place).
  const moment: ViewCell = { kind: "view", label: "", scene: cell.scene, view: cell.view, animation: cell.animation, time: cell.time, camera: cell.camera, ...(cell.kind === "hit" && cell.offset ? { offset: cell.offset } : {}), ...(cell.kind === "hit" && cell.extra ? { extra: cell.extra } : {}) }
  // K1: what is drawn over the moment: one red shape where a hit lands, or a creature's collision boxes, each in the colour of what it is.
  const shapes = cell.kind === "hit" ? [{ faces: cell.faces, ...SHAPE_COLOURS.hit }] : cell.boxes.map((box) => ({ faces: box.faces, ...hitboxAppearance(box) }))
  const over = cell.kind === "hit" ? cell.over : undefined
  // The caption is laid out first: the picture is drawn into the part of the cell above its band (`pictureSize`), with the camera the cell has, so nothing the camera frames is under the band.
  // A cell with no caption is drawn into the whole cell, as it always was. A sentence that reports a fault keeps its colour over every row it wraps onto.
  sheet.font = "600 15px sans-serif"
  sheet.textBaseline = "middle"
  const faulty = (line: string) => line.startsWith("对不上") || line.startsWith("缺：") || line.includes("看不到蓄力") || line.includes("没有蓄力") || line.startsWith(HITBOX_FAULT_MARK)
  const lines = cell.caption.length ? captionLayout(cell.caption, size[0] - 20, size[1], (text) => sheet.measureText(text).width).map((row) => ({ text: row.text, fault: faulty(cell.caption[row.sentence]!) })) : []
  const area = pictureSize(size, lines.length)
  if (over?.length) sheet.putImageData(await layered(scenes, moment, over, area), at[0], at[1])
  else if (cell.kind === "hit" && cell.light) {
    sheet.save()
    sheet.fillStyle = {白天:"#b1c6ca",夜晚:"#242e3d",压暗:"#141720",起雾:"#677375"}[cell.light]
    sheet.fillRect(...at,...area)
    sheet.restore()
    await shoot(sheet, scene, moment, at, area, true, scenes)
  } else await shoot(sheet, scene, moment, at, area, false, scenes)
  const blank = () => {
    const canvas = document.createElement("canvas")
    canvas.width = area[0]
    canvas.height = area[1]
    const context = canvas.getContext("2d")
    if (!context) throw new Error("no 2d canvas")
    return { canvas, context }
  }
  // Everything drawn at this moment, by itself: the last layer holds the creature and every effect.
  const body = blank()
  const fullest = over?.at(-1)
  await shoot(body.context, scenes[fullest?.scene ?? cell.scene] ?? scene, fullest ? { ...moment, scene: fullest.scene, extra: fullest.extra } : moment, [0, 0], area, true, scenes)
  const flat = projector(cell.camera, area)
  // A shape may reach past the camera; what lies behind it has no place in the picture, so each face is cut off a little in front of the lens.
  const gaze = cell.camera.target.map((value, axis) => value - cell.camera.position[axis]!)
  const depth = (point: Vector) => point.reduce((sum, value, axis) => sum + (value - cell.camera.position[axis]!) * gaze[axis]!, 0) / Math.hypot(...gaze) - 2
  const ahead = (face: Vector[]) =>
    face.flatMap((point, index) => {
      const next = face[(index + 1) % face.length]!
      const crossing = depth(point) / (depth(point) - depth(next))
      return [...(depth(point) >= 0 ? [point] : []), ...(depth(point) >= 0 !== depth(next) >= 0 ? [point.map((value, axis) => value + (next[axis]! - value) * crossing) as Vector] : [])]
    })
  const traced = (context: CanvasRenderingContext2D, face: Vector[]) => {
    context.beginPath()
    ahead(face).map(flat).forEach((point, index) => (index ? context.lineTo(point[0], point[1]) : context.moveTo(point[0], point[1])))
    context.closePath()
  }
  // Each part is drawn whole on a layer of its own and laid over once, so it is as strong wherever it is, however many faces lie behind one another.
  const laid = (alpha: number, paint: (context: CanvasRenderingContext2D) => void, where: "around" | "across") => {
    const layer = blank()
    paint(layer.context)
    // `around`: not on the creature. `across`: only on it.
    layer.context.globalCompositeOperation = where === "around" ? "destination-out" : "destination-in"
    layer.context.drawImage(body.canvas, 0, 0)
    sheet.save()
    sheet.globalAlpha = alpha
    sheet.drawImage(layer.canvas, at[0], at[1])
    sheet.restore()
  }
  const filled = (faces: Vector[][], colour: string) => (context: CanvasRenderingContext2D) => {
    context.fillStyle = colour
    faces.forEach((face) => {
      traced(context, face)
      context.fill()
    })
  }
  const outlined = (faces: Vector[][], colour: string, width: number) => (context: CanvasRenderingContext2D) => {
    context.lineWidth = width
    context.lineJoin = "round"
    context.strokeStyle = colour
    faces.forEach((face) => {
      traced(context, face)
      context.stroke()
    })
  }
  shapes.forEach((shape) => {
    laid(0.14, filled(shape.faces, shape.fill), "around")
    // Where the shape falls on the ground: every face dropped straight down onto it. Seen from above this is the whole reach.
    laid(0.2, filled(shape.faces.map((face) => face.map((point): Vector => [point[0], 0, point[2]])), shape.fill), "around")
  })
  // K1: a collision box is judged by where its edge cuts the body, so its lines stay strong across the creature; a hit shape's are kept thin there.
  shapes.forEach((shape) => {
    laid(cell.kind === "hit" ? 0.85 : 0.95, outlined(shape.faces, shape.stroke, cell.kind === "hit" ? 1.5 : 2), "around")
    laid(cell.kind === "hit" ? 0.3 : 0.7, outlined(shape.faces, shape.stroke, 1.5), "across")
  })
  // Boss 能力 11: a weapon trail is the curve its part's far end swept, over everything in its own colour on a dark edge (so a pale one shows on the sky), with a ring where it starts and a dot where it ends.
  if (cell.kind === "hit")
    (cell.trails ?? []).forEach((trail) => {
      const points = trail.points.filter((point) => depth(point) >= 0).map(flat)
      if (!points.length) return
      sheet.save()
      sheet.translate(at[0], at[1])
      sheet.lineJoin = "round"
      sheet.lineCap = "round"
      // Boss 能力 2: a thrown thing's flight is drawn dashed, so it reads as a path through the air and not as a swing of a part.
      if (trail.dashed) sheet.setLineDash([9, 7])
      const stroke = (colour: string, width: number) => {
        sheet.strokeStyle = colour
        sheet.lineWidth = width
        sheet.beginPath()
        points.forEach((point, index) => (index ? sheet.lineTo(point[0], point[1]) : sheet.moveTo(point[0], point[1])))
        sheet.stroke()
      }
      stroke("rgba(20, 20, 20, 0.7)", 7)
      stroke(trail.color, 4)
      sheet.setLineDash([])
      sheet.fillStyle = trail.color
      sheet.strokeStyle = "rgba(20, 20, 20, 0.85)"
      sheet.lineWidth = 2
      sheet.beginPath()
      sheet.arc(points[0]![0], points[0]![1], 6, 0, Math.PI * 2)
      sheet.stroke()
      sheet.beginPath()
      sheet.arc(points.at(-1)![0], points.at(-1)![1], 5, 0, Math.PI * 2)
      sheet.fill()
      sheet.stroke()
      sheet.restore()
    })
  if (cell.kind === "hit" && cell.particles?.length) {
    sheet.save()
    sheet.translate(...at)
    sheet.beginPath()
    sheet.rect(0,0,...area)
    sheet.clip()
    const images = new Map<string, HTMLImageElement>()
    const labels = new Set<string>()
    for (const group of cell.particles) {
      let sprite: HTMLCanvasElement | null = null
      if (group.frame) {
        const image = images.get(group.frame) ?? new Image()
        if (!image.src) { image.src = group.frame; await image.decode(); images.set(group.frame, image) }
        sprite = document.createElement("canvas")
        sprite.width = image.width
        sprite.height = image.height
        const ctx = sprite.getContext("2d")!
        ctx.drawImage(image, 0, 0)
        const pixels = ctx.getImageData(0,0,image.width,image.height)
        for (let i=0; i<pixels.data.length; i+=4) for (let c=0; c<3; c++) pixels.data[i+c] = pixels.data[i+c]! * group.rgb[c]! * (group.emissive || !cell.light || cell.light==="白天" ? 1 : cell.light==="起雾" ? 0.65 : 0.29)
        ctx.putImageData(pixels,0,0)
      }
      for (const [index,point] of group.points.entries()) {
        if (depth(point) <= 0) continue
        const [x,y] = flat(point)
        const side = Math.max(2, group.size*16*area[1]/(2*(depth(point)+2)*Math.tan(cell.camera.fov*Math.PI/360)))
        sheet.save()
        sheet.translate(x,y)
        sheet.globalAlpha = group.opacity
        if (sprite) {
          const vector=group.vectors?.[index]
          const projected=vector && flat(point.map((value,i)=>value+vector[i]!) as Vector)
          const along=projected && Math.hypot(projected[0]-x,projected[1]-y)>1e-5
          const length=side*(along ? group.stretch ?? 1 : 1)
          const factor=along && group.screenLimit ? Math.min(1,area[1]*group.screenLimit/length) : 1
          const width=length*factor, height=side*factor
          sheet.rotate(along ? Math.atan2(projected[1]-y,projected[0]-x) : group.turn*Math.PI/180)
          sheet.imageSmoothingEnabled = false
          sheet.drawImage(sprite,-width/2,-height/2,width,height)
        } else {
          // The game's own particles (no picture): a dot of their size and colour, at least 3 pixels, ringed dark so a pale one still shows against the sky.
          const radius = Math.max(3, side/2)
          sheet.fillStyle = `rgb(${group.rgb.map((value) => Math.round(Math.min(1, value)*255)).join(",")})`
          sheet.beginPath(); sheet.arc(0,0,radius,0,2*Math.PI); sheet.fill()
          if (radius > 3) { sheet.strokeStyle = "rgba(0,0,0,0.55)"; sheet.lineWidth = 1; sheet.stroke() }
          if (!labels.has(group.name) && x>0 && y>0 && x<area[0]-30 && y<area[1]) {
            labels.add(group.name); sheet.fillText(group.name,5,0)
          }
        }
        sheet.restore()
      }
    }
    if (cell.light) {
      // One measured flight from each burst. Its body stays one stroke wide at every zoom.
      for (const group of cell.particles.slice(0,1)) for (const trace of group.traces??[]) {
        const a=flat(trace.from), b=flat(trace.to), dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy)
        if (length<7) continue
        const ux=dx/length,uy=dy/length
        sheet.save()
        sheet.strokeStyle=cell.light==="白天"?"#78370a":"#ffdb80"
        sheet.fillStyle=sheet.strokeStyle
        sheet.lineWidth=2
        sheet.beginPath();sheet.arc(a[0],a[1],4,0,2*Math.PI);sheet.stroke()
        sheet.beginPath(); sheet.moveTo(...a);sheet.lineTo(...b)
        sheet.stroke()
        const head = Math.min(14, length / 2)
        sheet.beginPath()
        sheet.moveTo(...b)
        sheet.lineTo(b[0]-head*ux+head*.48*uy,b[1]-head*uy-head*.48*ux)
        sheet.lineTo(b[0]-head*ux-head*.48*uy,b[1]-head*uy+head*.48*ux)
        sheet.closePath()
        sheet.fill()
        sheet.font="bold 13px sans-serif"
        const tag=(s:string,x:number,y:number)=>{
          const w=sheet.measureText(s).width
          sheet.fillStyle="rgba(29,35,42,.82)";sheet.fillRect(x-2,y-8,w+4,16)
          sheet.fillStyle="#ffdf9c";sheet.fillText(s,x,y)
        }
        if(length>=15) {
          const displacements = trace.to.map((value,i)=>value-trace.from[i]!)
          const blocks = Number((Math.hypot(...displacements)/16).toFixed(1))
          const tip = "已移动 " + blocks + " 格"
          tag("起点", Math.max(4,Math.min(area[0]-36,a[0]+7)), Math.max(37,a[1]-10))
          tag(tip, Math.max(4,Math.min(area[0]-sheet.measureText(tip).width-5,b[0]+7)), Math.max(37,Math.min(area[1]-12,b[1]+12)))
        }
        sheet.restore()
      }
      const scale=16*area[1]/(2*(depth(cell.camera.target)+2)*Math.tan(cell.camera.fov*Math.PI/360))
      sheet.save();sheet.fillStyle="#23313b";sheet.fillRect(7,area[1]-19,scale+9,17)
      sheet.fillStyle="#fff";sheet.fillRect(11,area[1]-6,scale,1);sheet.font="11px sans-serif"
      sheet.fillText("1 格",12,area[1]-12);sheet.restore()
    }
    if (cell.sourceCorners?.length) {
      const projected=cell.sourceCorners.map(flat)
      const xs=projected.map(p=>p[0]),ys=projected.map(p=>p[1])
      const x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0
      const size=Math.max(w,h,5)*2.8, x=x0+w/2-size/2,y=y0+h/2-size/2
      const side=82, start=area[0]-side-5
      sheet.save();sheet.fillStyle="#a8b7bf";sheet.fillRect(start,32,side,side)
      sheet.drawImage(body.canvas,x,y,size,size,start,32,side,side)
      sheet.strokeStyle="#ffbd4d";sheet.lineWidth=2
      sheet.strokeRect(start+(x0-x)*side/size,32+(y0-y)*side/size,Math.max(3,w*side/size),Math.max(3,h*side/size))
      sheet.fillStyle="#23313b";sheet.fillRect(start,32+side,side,16)
      sheet.fillStyle="#fff";sheet.font="12px sans-serif";sheet.fillText("发射部位放大",start+4,32+side+8);sheet.restore()
    }
    sheet.restore()
  }
  if (!lines.length) return
  sheet.fillStyle = "rgba(20, 20, 20, 0.82)"
  sheet.fillRect(at[0], at[1] + size[1] - captionBand(lines.length), size[0], captionBand(lines.length))
  lines.forEach((line, index) => {
    sheet.fillStyle = line.fault ? "#ffb3a8" : "#ffffff"
    sheet.fillText(line.text, at[0] + 10, at[1] + size[1] - (lines.length - index) * CAPTION.row + 7)
  })
}

/** Write each part's name where the part is on the picture, moved down when two would sit on top of each other. */
function named(sheet: CanvasRenderingContext2D, design: ModelDesign, view: { position: Vector; target: Vector; fov: number }, at: [number, number], size: [number, number]) {
  const camera = new THREE.PerspectiveCamera(view.fov, size[0] / size[1], 0.5, 5000)
  camera.position.set(...view.position)
  camera.lookAt(...view.target)
  camera.updateMatrixWorld(true)
  sheet.font = "600 15px sans-serif"
  sheet.textBaseline = "middle"
  design.bones
    .flatMap((bone) => {
      const box = bone.cubes.length ? boxOf(design, bone.name, true) : null
      if (!box) return []
      const point = new THREE.Vector3((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2).project(camera)
      return [{ name: bone.name, x: at[0] + ((point.x + 1) / 2) * size[0], y: at[1] + ((1 - point.y) / 2) * size[1] }]
    })
    .sort((left, right) => left.y - right.y)
    .reduce<{ x: number; y: number; width: number }[]>((drawn, label) => {
      const width = sheet.measureText(label.name).width + 10
      const x = Math.min(Math.max(at[0] + 2, label.x - width / 2), at[0] + size[0] - width - 2)
      const y = drawn.reduce((low, other) => (Math.abs(other.x - x) < Math.max(width, other.width) && Math.abs(low - other.y) < 20 ? other.y + 20 : low), Math.max(at[1] + 40, label.y))
      sheet.fillStyle = "rgba(20, 20, 20, 0.78)"
      sheet.fillRect(x, y - 10, width, 20)
      sheet.fillStyle = "#ffffff"
      sheet.fillText(label.name, x + 5, y)
      return [...drawn, { x, y, width }]
    }, [])
}

/** A picture laid flat, every pixel kept square and sharp. */
async function flat(sheet: CanvasRenderingContext2D, url: string, at: [number, number], size: [number, number], smooth = false) {
  const picture = new Image()
  picture.src = url
  // A reference is whatever file a person had: one that cannot be read is said so in its cell and the rest of the sheet is still drawn.
  const read = await picture.decode().then(
    () => picture.width > 0 && picture.height > 0,
    (error: unknown) => (smooth ? false : Promise.reject(error)),
  )
  sheet.fillStyle = "#5b5b5b"
  sheet.fillRect(at[0], at[1], size[0], size[1])
  if (!read) {
    sheet.font = "600 18px sans-serif"
    sheet.textBaseline = "middle"
    sheet.fillStyle = "#ffffff"
    sheet.fillText("这张图读不出来", at[0] + 24, at[1] + size[1] / 2)
    return
  }
  const scale = Math.min((size[0] - 24) / picture.width, (size[1] - 56) / picture.height)
  sheet.imageSmoothingEnabled = smooth
  sheet.imageSmoothingQuality = "high"
  sheet.drawImage(picture, at[0] + (size[0] - picture.width * scale) / 2, at[1] + 40 + (size[1] - 56 - picture.height * scale) / 2, picture.width * scale, picture.height * scale)
  sheet.imageSmoothingEnabled = true
}

async function draw(job: LookJob, sheet: LookSheet) {
  const canvas = document.createElement("canvas")
  canvas.width = sheet.columns * sheet.cell[0]
  const gridHeight = Math.ceil(sheet.cells.length / sheet.columns) * sheet.cell[1]
  canvas.height = gridHeight + (sheet.weightTimeline ? 124 : 0)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("no 2d canvas")
  context.fillStyle = BACKGROUND
  context.fillRect(0, 0, canvas.width, canvas.height)
  // One at a time: each model cell holds a 3D context while it is drawn.
  await sheet.cells.reduce(async (before, cell, index) => {
    await before
    const at: [number, number] = [(index % sheet.columns) * sheet.cell[0], Math.floor(index / sheet.columns) * sheet.cell[1]]
    if (cell.kind === "flat") await flat(context, cell.url, at, sheet.cell, cell.picture === true)
    if (cell.kind === "view") {
      if (cell.particles?.length && cell.camera && cell.time !== undefined && cell.animation) {
        await hit(context, job.scenes[cell.scene]!, { ...cell, kind: "hit", time: cell.time, animation: cell.animation, camera: cell.camera, faces: [], caption: cell.caption ?? [] }, at, sheet.cell, job.scenes)
      } else await shoot(context, job.scenes[cell.scene]!, cell, at, sheet.cell)
    }
    if (cell.kind === "compare") await compared(context, job.scenes[cell.scene]!, cell, at, sheet.cell)
    if (cell.kind === "hit" || cell.kind === "boxes") await hit(context, job.scenes[cell.scene]!, cell, at, sheet.cell, job.scenes)
    if (cell.kind === "tiles" || cell.kind === "blocks" || cell.kind === "slots" || cell.kind === "held") await drawFlat(context, cell, at, sheet.cell)
    context.font = "600 16px sans-serif"
    context.textBaseline = "middle"
    context.fillStyle = "rgba(20, 20, 20, 0.82)"
    context.fillRect(at[0], at[1], Math.min(sheet.cell[0], context.measureText(cell.label).width + 20), 30)
    context.fillStyle = "#ffffff"
    context.fillText(cell.label, at[0] + 10, at[1] + 15)
    context.strokeStyle = "rgba(20, 20, 20, 0.5)"
    context.strokeRect(at[0] + 0.5, at[1] + 0.5, sheet.cell[0] - 1, sheet.cell[1] - 1)
  }, Promise.resolve())
  if (sheet.weightTimeline) {
    const {seconds, windup, rows} = sheet.weightTimeline
    const left = 65, width = canvas.width - left - 18
    context.fillStyle = "#202936"
    context.fillRect(0, gridHeight, canvas.width, 124)
    context.font = "15px sans-serif"
    context.fillStyle = "white"
    context.fillText("0 秒", left, gridHeight + 14)
    context.fillText(`${seconds} 秒`, canvas.width - 58, gridHeight + 14)
    const edge = left + width * windup / seconds
    context.fillText("出手", Math.min(canvas.width - 95, Math.max(left + 44, edge)), gridHeight + 14)
    rows.forEach((points, row) => {
      const y = gridHeight + 30 + 23 * row
      context.fillStyle = "white"
      context.fillText(["看向", "摆动", "跟随", "挂链"][row]!, 10, y + 9)
      context.fillStyle = "#3a4755"
      context.fillRect(left, y, width, 18)
      context.fillStyle = ["#59c4e5", "#68ce96", "#eeb361", "#bd9ee5"][row]!
      for (let i = 0; i < points.length; i++) {
        const height = 18 * points[i]!
        context.fillRect(left + width * i / points.length, y + 18 - height, Math.ceil(width / points.length), height)
      }
      context.fillStyle = "#f8f9fa"
      context.fillRect(edge, y, 1, 18)
    })
  }
  return { label: sheet.label, url: canvas.toDataURL("image/jpeg", 0.84) }
}

/** Called by the main process. Always answers: the pictures, or one plain sentence on why there are none. */
async function renderLook(job: LookJob): Promise<LookPictures> {
  return job.sheets
    .reduce<Promise<{ label: string; url: string }[]>>(async (before, sheet) => [...(await before), await draw(job, sheet)], Promise.resolve([]))
    .then(
      (pictures): LookPictures => ({ ok: true, pictures }),
      (error: unknown): LookPictures => ({ ok: false, reason: /webgl/i.test(String(error)) ? "这台电脑现在画不出三维预览（没有可用的图形加速）。" : "预览图没有画出来。" }),
    )
    .finally(() => THREE.Cache.clear())
}

// The main process keeps the look queue. These calls let it report a sheet as soon as it is drawn.
const currentLook: { job?: LookJob } = {}
Object.assign(window, {
  renderLook,
  openLook: (job: LookJob) => { currentLook.job = job; return true },
  drawLookSheet: (index: number) => {
    const job = currentLook.job
    if (!job || !job.sheets[index]) throw new Error("No look sheet")
    return draw(job, job.sheets[index]!)
  },
  closeLook: () => { delete currentLook.job; THREE.Cache.clear(); return true },
})

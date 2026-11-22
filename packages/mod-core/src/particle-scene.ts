import type { LookOptions } from "@minemods/studio-ai/making"
import type { SceneExample } from "./particle-context"
import { particleAt, appearancePixels, particleTicks, type ParticleDocument } from "./particle"

type Scatter = NonNullable<LookOptions["particle_emit"]>
type Point = { x: number; y: number; z: number }
const circle = 2 * Math.PI

// java.util.Random.nextDouble, so the same seed and spreads give the emitter's positions.
function random(seed: number) {
  const mask = (1n << 48n) - 1n,
    multiplier = 0x5deece66dn
  let state = (BigInt(seed) ^ multiplier) & mask
  const bits = (n: number) => {
    state = (state * multiplier + 11n) & mask
    return Number(state >> (48n - BigInt(n)))
  }
  return () => (bits(26) * 134217728 + bits(27)) / 9007199254740992
}

export function particleFlight(doc: ParticleDocument, emission: Scatter = { velocity: { up: 1.4, outward: 1.8 } }) {
  const next = random(emission.seed ?? 7),
    spread = emission.spread ?? 0.5
  const { x: sx, y: sy, z: sz } = typeof spread === "number" ? { x: spread, y: spread, z: spread } : spread
  const yaw = ((emission.yaw ?? 0) * Math.PI) / 180,
    cos = Math.cos(yaw),
    sin = Math.sin(yaw)
  const velocity = emission.velocity ?? {},
    ticks = particleTicks(doc)
  const trails = Array.from({ length: emission.count ?? 12 }, () => {
    const theta = next() * circle,
      h = next() * 2 - 1
    const sphere = !emission.shape || emission.shape === "sphere"
    const radius = emission.shape === "ring" ? 1 : sphere ? Math.cbrt(next()) : Math.sqrt(next())
    const flat = sphere ? radius * Math.sqrt(1 - h * h) : radius
    const side = Math.cos(theta) * flat * sx,
      ahead = Math.sin(theta) * flat * sz
    const start = { x: side * cos - ahead * sin, y: h * sy * (sphere ? radius : 1), z: ahead * cos + side * sin }
    const norm = Math.hypot(start.x, start.y, start.z),
      radial = norm ? (velocity.outward ?? 0) / norm : 0
    const rate = (1 + (velocity.vary ?? 0) * (2 * next() - 1)) / 20
    let dx = ((velocity.left ?? 0) * cos - (velocity.forward ?? 0) * sin + radial * start.x) * rate
    let dy = ((velocity.up ?? 0) + radial * start.y) * rate
    let dz = ((velocity.forward ?? 0) * cos + (velocity.left ?? 0) * sin + radial * start.z) * rate
    const path: Point[] = [start]
    for (let tick = 1; tick <= ticks; tick++) {
      dy -= 0.04 * doc.gravity
      const last = path[tick - 1]!,
        moved = { x: last.x + dx, y: last.y + dy, z: last.z + dz }
      const drag = doc.drag ?? 0.98
      dx *= drag
      dy *= drag
      dz *= drag
      if (emission.motion?.type === "converge") {
        const k = 1 - (tick / ticks) ** 2
        path.push({ x: start.x * k, y: start.y * k, z: start.z * k })
      } else if (emission.motion?.type === "orbit") {
        const a = (circle * emission.motion.turns) / 20,
          c = Math.cos(a),
          s = Math.sin(a)
        path.push({ x: c * moved.x - s * moved.z, y: moved.y, z: s * moved.x + c * moved.z })
        const vx = dx
        dx = c * dx - s * dz
        dz = s * vx + c * dz
      } else path.push(moved)
    }
    return path
  })
  return trails
}

// Orthographic projection. All eight stills and playback use the same scale and camera.
export function particleScene(doc: ParticleDocument, emission?: Scatter, example?:SceneExample) {
  const paths = particleFlight(doc, emission),
    frames = doc.frames.map(frame => appearancePixels(frame, doc.edge)),
    ticks = particleTicks(doc)
  const width = 240,
    height = 180,
    extent = example ? paths.reduce((max,path)=>path.reduce((n,p)=>Math.max(n,Math.abs(p.x+(example.left??0)),Math.abs(p.z+(example.forward??0)),Math.abs(p.y+(example.height??0))),max),1) : 1,
    scale = Math.min(46,64/extent)
  const tint = [1, 3, 5].map((i) => parseInt((emission?.tint ?? "#ffffff").slice(i, i + 2), 16) / 255)
  const project = (p: Point) =>
    [width * 0.55 + scale * (p.x * 0.82 - p.z * 0.57), height * 0.66 - scale * (p.y + 0.22 * p.x + 0.32 * p.z)] as const
  const bursts = example?.repeat ? Array.from({length:1+Math.floor(Math.min(ticks, example.duration??ticks)/example.repeat)},(_,i)=>({at:i*example.repeat!,paths:i?particleFlight(doc,{...emission,seed:(emission?.seed??7)+i*127}):paths})) : [{at:0,paths}]
  return (age: number, night: boolean | "fog" | "dark" = false) => {
    const pixels = new Uint8Array(width * height * 4)
    const paint = (x: number, y: number, r: number, g: number, b: number, alpha = 1) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return
      const at = (Math.floor(y) * width + Math.floor(x)) * 4
      pixels[at] = Math.round(pixels[at]! * (1 - alpha) + r * alpha)
      pixels[at + 1] = Math.round(pixels[at + 1]! * (1 - alpha) + g * alpha)
      pixels[at + 2] = Math.round(pixels[at + 2]! * (1 - alpha) + b * alpha)
      pixels[at + 3] = 255
    }
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (y < 36) {
          paint(x, y, ...((night==="fog" ? [89,99,103] : night==="dark" ? [16,19,29] : night ? [26, 35, 51] : [174, 205, 224]) as [number, number, number]))
          continue
        }
        const horizontal = (x - width * 0.55) / scale,
          depth = (height * 0.66 + scale * 0.82 - y) / scale
        const gx = (0.32 * horizontal + 0.57 * depth) / 0.3878,
          gz = (-0.22 * horizontal + 0.82 * depth) / 0.3878
        const grid = Math.abs(gx - Math.round(gx)) < 0.021 || Math.abs(gz - Math.round(gz)) < 0.021
        const shade = night==="fog" ? (grid?94:87) : night==="dark" ? (grid?29:20) : night ? (grid ? 52 : 38) : grid ? 142 : 168
        paint(x, y, shade - 6, shade + 4, shade - 5)
      }
    const rect = (x: number, y: number, w: number, h: number) => {
      for (let j = y; j < y + h; j++)
        for (let i = x; i < x + w; i++)
          paint(i, j, ...((night ? [22, 29, 41] : [74, 88, 99]) as [number, number, number]))
    }
    const foot = Math.round(height * 0.66 + scale * 0.82),
      head = foot - Math.round(scale * 1.8)
    const body = (x:number,y:number,w:number,h:number) =>
      rect(Math.round(39+(x-39)*scale/46),head+Math.round(y*scale/46),Math.max(1,Math.round(w*scale/46)),Math.max(1,Math.round(h*scale/46)))
    body(30, 0, 18, 18)
    body(29, 19, 20, 33)
    body(21, 20, 7, 31)
    body(50, 20, 7, 31)
    body(29, 52, 9, 31)
    body(40, 52, 9, 31)
    for (const burst of bursts) {
    const time = Math.floor(age)-burst.at
    if(time<0 || time>ticks) continue
    const now = particleAt(doc, time)
    burst.paths.forEach((path, i) => {
      const position = path[time]!
      const [cx, cy] = project({x:position.x+(example?.left??0),z:position.z+(example?.forward??0),y:position.y+(example?.height??0)}),
        [ax, ay] = project(path[Math.max(0, time - 1)]!),
        [bx, by] = project(path[Math.min(ticks, time + 1)]!)
      const moving = doc.face === "motion" && Math.hypot(bx - ax, by - ay) > 1e-7
      const angle = moving ? Math.atan2(by - ay, bx - ax) : (now.turn * Math.PI) / 180,
        c = Math.cos(angle),
        s = Math.sin(angle)
      const side=Math.max(0.5,now.size*scale), length=side*(moving ? doc.stretch??1 : 1)
      const factor=moving && doc.screen_limit ? Math.min(1,height*doc.screen_limit/length) : 1
      const h=side*factor, w=length*factor,
        bound = Math.hypot(w, h) / 2
      const tile = frames[doc.frames_by === "random" ? i % frames.length : now.frame]!
      for (let y = Math.max(0, Math.floor(cy - bound)); y < Math.min(height, cy + bound + 1); y++)
        for (let x = Math.max(0, Math.floor(cx - bound)); x < Math.min(width, cx + bound + 1); x++) {
          const dx = x + 0.5 - cx,
            dy = y + 0.5 - cy,
            u = 0.5 + (c * dx + s * dy) / w,
            v = 0.5 + (-s * dx + c * dy) / h
          if (u < 0 || v < 0 || u >= 1 || v >= 1) continue
          const at = (Math.floor(v * tile.width) * tile.width + Math.floor(u * tile.width)) * 4,
            light = night && !doc.emissive ? 0.29 : 1
          const color = (k: number) => tile.pixels[at + k]! * now.color[k]! * tint[k]! * light
          paint(x, y, color(0), color(1), color(2), (tile.pixels[at + 3]! / 255) * now.opacity)
        }
    })
    }
    return { width, height, pixels }
  }
}

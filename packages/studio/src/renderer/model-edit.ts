import { ModelDesignSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import { overBudget, tierOf } from "@minemods/studio-ai/budget"
import { cubePaint } from "@minemods/studio-ai/model-paint"

/**
 * Manual, AI-free edits for the creature model. Every operation returns a new design or an error
 * message; the result is always checked against the same contract the saving service uses.
 */
export type ModelEditResult = { ok: true; design: ModelDesign } | { ok: false; message: string }
export type Axis = 0 | 1 | 2

type Bone = ModelDesign["bones"][number]
type Cube = Bone["cubes"][number]
export type FaceName = keyof Cube["faces"]

const faceNames: FaceName[] = ["north", "east", "south", "west", "up", "down"]

const clone = (design: ModelDesign): ModelDesign => structuredClone(design)

function finish(design: ModelDesign, failure: string): ModelEditResult {
  const parsed = ModelDesignSchema.safeParse(design)
  if (parsed.success) return { ok: true, design: parsed.data }
  return { ok: false, message: failure }
}

/** The bone and every bone beneath it. */
export function boneFamily(design: ModelDesign, name: string) {
  const family = new Set([name])
  const grow = (): void => {
    const added = design.bones.filter((bone) => bone.parent && family.has(bone.parent) && !family.has(bone.name))
    added.forEach((bone) => family.add(bone.name))
    if (added.length) grow()
  }
  grow()
  return family
}

/** Resolve a viewport selection ("bone" or "bone.cube") to its bone name. */
export function boneOf(design: ModelDesign | null | undefined, part: string) {
  if (!design || !part) return undefined
  return design.bones.find((bone) => part === bone.name || part.startsWith(`${bone.name}.`))?.name
}

const hexToHsl = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const light = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: light }
  const delta = max - min
  const s = light > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  const h =
    max === r ? ((g - b) / delta + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / delta + 2) / 6 : ((r - g) / delta + 4) / 6
  return { h, s, l: light }
}

const hslToHex = (h: number, s: number, l: number) => {
  const channel = (n: number) => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0")
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/** Distinct face colours used by the model, most frequent first. */
export function modelPalette(design: ModelDesign, limit = 8) {
  const counts = new Map<string, number>()
  design.bones
    .flatMap((bone) => bone.cubes)
    .flatMap((cube) => faceNames.map((face) => cube.faces[face].toLowerCase()))
    .forEach((color) => counts.set(color, (counts.get(color) ?? 0) + 1))
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([color]) => color)
}

/**
 * Recolour one part. Each face keeps its light/dark difference from the part's average,
 * so the shading painted by the model survives the new colour.
 */
export function tintBone(design: ModelDesign, name: string, color: string): ModelEditResult {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { ok: false, message: "颜色格式无效。" }
  const next = clone(design)
  const bone = next.bones.find((value) => value.name === name)
  if (!bone?.cubes.length) return { ok: false, message: "这个部件没有可以上色的方块。" }
  const target = hexToHsl(color)
  // A painted cube shows its material's colours, not its faces': those are the ones recoloured, on the cube itself so the parts that share a painted parent keep theirs.
  const paints = new Map(bone.cubes.map((cube) => [cube, cubePaint(next, bone, cube)]))
  const colors = bone.cubes.flatMap((cube) => {
    const paint = paints.get(cube)
    return [
      ...(paint ? [paint.base, ...(paint.secondary ? [paint.secondary] : [])] : faceNames.map((face) => cube.faces[face])),
      ...cube.surface_details.map((detail) => detail.color),
    ]
  })
  const average = colors.reduce((sum, value) => sum + hexToHsl(value).l, 0) / colors.length
  const shift = (value: string) => {
    const light = Math.min(0.97, Math.max(0.03, target.l + hexToHsl(value).l - average))
    return hslToHex(target.h, target.s, light)
  }
  bone.cubes.forEach((cube) => {
    faceNames.forEach((face) => (cube.faces[face] = shift(cube.faces[face])))
    cube.surface_details.forEach((detail) => (detail.color = shift(detail.color)))
    const paint = paints.get(cube)
    if (paint) cube.paint = { ...paint, base: shift(paint.base), ...(paint.secondary ? { secondary: shift(paint.secondary) } : {}) }
  })
  return finish(next, "颜色没有应用成功。")
}

/** Move a part (and everything attached to it) along one axis. */
export function moveBone(design: ModelDesign, name: string, axis: Axis, delta: number): ModelEditResult {
  const next = clone(design)
  const family = boneFamily(next, name)
  next.bones
    .filter((bone) => family.has(bone.name))
    .forEach((bone) => {
      bone.pivot[axis] += delta
      bone.cubes.forEach((cube) => (cube.origin[axis] += delta))
    })
  return finish(next, "再移动就超出模型允许的范围了。")
}

/** Turn a part's resting pose; animations keep playing on top of it. */
export function rotateBone(design: ModelDesign, name: string, axis: Axis, degrees: number): ModelEditResult {
  const next = clone(design)
  const bone = next.bones.find((value) => value.name === name)
  if (!bone) return { ok: false, message: "找不到这个部件。" }
  const turned = bone.rotation[axis] + degrees
  bone.rotation[axis] = ((((turned + 180) % 360) + 360) % 360) - 180
  return finish(next, "这个角度无法保存。")
}

/** Grow or shrink the blocks of one part around its pivot. Sizes stay whole blocks. */
export function scaleBone(design: ModelDesign, name: string, factor: number): ModelEditResult {
  const next = clone(design)
  const bone = next.bones.find((value) => value.name === name)
  if (!bone?.cubes.length) return { ok: false, message: "这个部件没有可以缩放的方块。" }
  const changed = bone.cubes.some((cube) => cube.size.some((value) => Math.max(1, Math.round(value * factor)) !== value))
  if (!changed) return { ok: false, message: factor < 1 ? "已经是最小尺寸了。" : "再放大也没有变化。" }
  bone.cubes.forEach((cube) => {
    const size = cube.size.map((value) => Math.max(1, Math.round(value * factor))) as Cube["size"]
    const origin = cube.origin.map((value, axis) => {
      const center = value + cube.size[axis]! / 2
      const scaled = bone.pivot[axis]! + (center - bone.pivot[axis]!) * factor
      return Math.round((scaled - size[axis]! / 2) * 2) / 2
    }) as Cube["origin"]
    cube.size = size
    cube.origin = origin
    cube.surface_details = cube.surface_details.filter((detail) => {
      const [width, height] = faceSize(size, detail.face, next.texel_size ?? 1)
      return detail.x + detail.width <= width && detail.y + detail.height <= height
    })
  })
  return finish(next, factor < 1 ? "不能再缩小了。" : "再放大就超出模型允许的范围了。")
}

/** Remove a part and everything attached to it. Motions that only moved removed parts go too. */
export function deleteBone(design: ModelDesign, name: string): ModelEditResult {
  const bone = design.bones.find((value) => value.name === name)
  if (!bone) return { ok: false, message: "找不到这个部件。" }
  if (bone.parent === null) return { ok: false, message: "根部件不能删除，它连着整个模型。" }
  const family = boneFamily(design, name)
  const next = clone(design)
  next.bones = next.bones.filter((value) => !family.has(value.name))
  next.animations = next.animations
    .map((animation) => ({
      ...animation,
      channels: animation.channels.filter((channel) => !family.has(channel.bone)),
    }))
    .filter((animation) => animation.channels.length)
  if (next.animations.length < 3) return { ok: false, message: "删掉它会让动作少于 3 组，请先保留这个部件。" }
  if (!next.bones.some((value) => value.cubes.length)) return { ok: false, message: "模型至少要保留一个方块。" }
  return finish(next, "删除后模型无法保存。")
}

/** Mirror a part across the left/right centre line as a new sibling part. */
export function mirrorBone(design: ModelDesign, name: string): ModelEditResult {
  const bone = design.bones.find((value) => value.name === name)
  if (!bone) return { ok: false, message: "找不到这个部件。" }
  if (bone.parent === null) return { ok: false, message: "根部件不能镜像复制。" }
  const family = boneFamily(design, name)
  const taken = new Set(design.bones.map((value) => value.name))
  const rename = (value: string) => {
    const swapped = value.replace(/left/g, "\u0000").replace(/right/g, "left").replace(/\u0000/g, "right")
    const base = swapped !== value ? swapped : `${value}_mirror`
    const pick = (index: number): string => {
      const candidate = (index ? `${base}_${index}` : base).slice(0, 48)
      return taken.has(candidate) ? pick(index + 1) : candidate
    }
    const chosen = pick(0)
    taken.add(chosen)
    return chosen
  }
  const names = new Map([...family].map((value) => [value, rename(value)]))
  const copies = design.bones
    .filter((value) => family.has(value.name))
    .map((value) => ({
      ...structuredClone(value),
      name: names.get(value.name)!,
      parent: value.parent && family.has(value.parent) ? names.get(value.parent)! : value.parent,
      pivot: [-value.pivot[0], value.pivot[1], value.pivot[2]] as Bone["pivot"],
      rotation: [value.rotation[0], -value.rotation[1], -value.rotation[2]] as Bone["rotation"],
      cubes: value.cubes.map((cube) => ({
        ...structuredClone(cube),
        origin: [-(cube.origin[0] + cube.size[0]), cube.origin[1], cube.origin[2]] as Cube["origin"],
        faces: { ...cube.faces, east: cube.faces.west, west: cube.faces.east },
        surface_details: cube.surface_details.map((detail) => ({
          ...detail,
          x: (["east", "west"].includes(detail.face) ? cube.size[2] : cube.size[0]) - detail.x - detail.width,
          face: detail.face === "east" ? ("west" as const) : detail.face === "west" ? ("east" as const) : detail.face,
        })),
      })),
    }))
  // Engineer H2: the limit is the model's own geometry tier's, and going over it is said with the numbers; nothing is cut down to fit.
  if (design.bones.length + copies.length > tierOf(design.budget).bones) return { ok: false, message: overBudget("bones", design.bones.length + copies.length, design.budget, "镜像复制以后") }
  const next = clone(design)
  next.bones = [...next.bones, ...copies]
  next.animations = next.animations.map((animation) => ({
    ...animation,
    channels: [
      ...animation.channels,
      ...animation.channels
        .filter((channel) => family.has(channel.bone))
        .map((channel) => ({
          ...channel,
          bone: names.get(channel.bone)!,
          keyframes: channel.keyframes.map((frame) => ({
            ...frame,
            rotation: [frame.rotation[0], -frame.rotation[1], -frame.rotation[2]] as Bone["rotation"],
          })),
          // A move to one side becomes a move to the other; a scale is the same on both sides.
          ...(channel.position ? { position: channel.position.map((frame) => ({ ...frame, position: [-frame.position[0], frame.position[1], frame.position[2]] as Bone["rotation"] })) } : {}),
        })),
    ],
  }))
  return finish(next, "镜像复制后模型无法保存，可能超出了方块数量上限。")
}

/** Undo/redo stack for one editing session. */
export function createHistory(initial: ModelDesign) {
  const past: ModelDesign[] = []
  const future: ModelDesign[] = []
  const state = { current: initial }
  return {
    get current() {
      return state.current
    },
    get canUndo() {
      return past.length > 0
    },
    get canRedo() {
      return future.length > 0
    },
    push(design: ModelDesign) {
      past.push(state.current)
      if (past.length > 100) past.shift()
      future.length = 0
      state.current = design
    },
    undo() {
      const previous = past.pop()
      if (!previous) return state.current
      future.push(state.current)
      state.current = previous
      return previous
    },
    redo() {
      const next = future.pop()
      if (!next) return state.current
      past.push(state.current)
      state.current = next
      return next
    },
  }
}

/* ---------- Texture painting ---------- */

export type Vec3 = [number, number, number]
export type Texel = { x: number; y: number }
export type PaintStroke = { part: string; face: FaceName; texels: Texel[] }

/** Width and height of a face in texels: one per model unit, or one per `texel`×`texel` of them for a model written with texel_size 2 or 4 (rounded up). */
export function faceSize(given: Cube["size"], face: FaceName, texel = 1): [number, number] {
  const size = texel === 1 ? given : given.map((value) => Math.max(1, Math.ceil(value / texel - 1e-9)))
  if (face === "up" || face === "down") return [size[0]!, size[2]!]
  if (face === "east" || face === "west") return [size[2]!, size[1]!]
  return [size[0]!, size[1]!]
}

/**
 * Where texel (0,0) of a face sits on a cube centred at the origin, and which way the texel x/y
 * axes run. This matches how the compiled texture is laid onto the box, so painting in the
 * editor lands on the same pixels the game shows.
 */
export function faceFrame(size: Cube["size"], face: FaceName): { origin: Vec3; u: Vec3; v: Vec3; normal: Vec3 } {
  const [x, y, z] = size.map((value) => value / 2) as Vec3
  switch (face) {
    case "east":
      return { origin: [x, y, z], u: [0, 0, -1], v: [0, -1, 0], normal: [1, 0, 0] }
    case "west":
      return { origin: [-x, y, -z], u: [0, 0, 1], v: [0, -1, 0], normal: [-1, 0, 0] }
    case "up":
      return { origin: [x, y, z], u: [-1, 0, 0], v: [0, 0, -1], normal: [0, 1, 0] }
    case "down":
      return { origin: [x, -y, -z], u: [-1, 0, 0], v: [0, 0, 1], normal: [0, -1, 0] }
    case "south":
      return { origin: [-x, y, z], u: [1, 0, 0], v: [0, -1, 0], normal: [0, 0, 1] }
    case "north":
      return { origin: [x, y, -z], u: [-1, 0, 0], v: [0, -1, 0], normal: [0, 0, -1] }
  }
}

/** Centre of a rectangle of texels on a face, lifted slightly off the surface. */
export function faceRectCenter(
  size: Cube["size"],
  face: FaceName,
  rect: { x: number; y: number; width: number; height: number },
  lift = 0,
): Vec3 {
  const frame = faceFrame(size, face)
  const along = rect.x + rect.width / 2
  const down = rect.y + rect.height / 2
  return [0, 1, 2].map(
    (axis) => frame.origin[axis]! + frame.u[axis]! * along + frame.v[axis]! * down + frame.normal[axis]! * lift,
  ) as Vec3
}

/** Which face and texel a point on (or just above) the surface of a centred cube falls on. */
export function texelAt(size: Cube["size"], point: Vec3, texel = 1): { face: FaceName; x: number; y: number } {
  const distance = [0, 1, 2].map((axis) => Math.abs(point[axis]!) - size[axis]! / 2)
  const axis = distance.indexOf(Math.max(...distance))
  const positive = point[axis]! >= 0
  const face: FaceName =
    axis === 0 ? (positive ? "east" : "west") : axis === 1 ? (positive ? "up" : "down") : positive ? "south" : "north"
  const frame = faceFrame(size, face)
  const offset = [0, 1, 2].map((index) => point[index]! - frame.origin[index]!)
  const dot = (vector: Vec3) => offset.reduce((sum, value, index) => sum + value * vector[index]!, 0)
  const [width, height] = faceSize(size, face, texel)
  return {
    face,
    x: Math.min(width - 1, Math.max(0, Math.floor(dot(frame.u) / texel))),
    y: Math.min(height - 1, Math.max(0, Math.floor(dot(frame.v) / texel))),
  }
}

const findCube = (design: ModelDesign, part: string) => {
  for (const bone of design.bones)
    for (const cube of bone.cubes) if (`${bone.name}.${cube.name}` === part) return cube
  return undefined
}

/** Whether the cube is drawn from a material, whose colours stand where its face colours would. */
const paintedCube = (design: ModelDesign, part: string) => {
  for (const bone of design.bones)
    for (const cube of bone.cubes) if (`${bone.name}.${cube.name}` === part) return cubePaint(design, bone, cube) !== null
  return false
}

/** The colour currently shown at one texel. */
export function texelColor(design: ModelDesign, part: string, face: FaceName, texel: Texel) {
  const cube = findCube(design, part)
  if (!cube) return undefined
  const hit = [...cube.surface_details]
    .reverse()
    .find(
      (detail) =>
        detail.face === face &&
        texel.x >= detail.x &&
        texel.x < detail.x + detail.width &&
        texel.y >= detail.y &&
        texel.y < detail.y + detail.height,
    )
  return (hit?.color ?? cube.faces[face]).toLowerCase()
}

/** Cover a colour grid with as few non-overlapping rectangles as possible (greedy). */
function rectangles(grid: (string | null)[][], width: number, height: number) {
  const used = grid.map((row) => row.map(() => false))
  const out: { x: number; y: number; width: number; height: number; color: string }[] = []
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const color = grid[y]![x]
      if (!color || used[y]![x]) continue
      let w = 1
      while (x + w < width && grid[y]![x + w] === color && !used[y]![x + w]) w++
      let h = 1
      const rowFits = (row: number) => {
        for (let column = x; column < x + w; column++)
          if (grid[row]![column] !== color || used[row]![column]) return false
        return true
      }
      while (y + h < height && rowFits(y + h)) h++
      for (let row = y; row < y + h; row++) for (let column = x; column < x + w; column++) used[row]![column] = true
      out.push({ x, y, width: w, height: h, color })
    }
  return out
}

/**
 * Paint (or erase, with `color` null) texels. Each touched face is re-encoded as the smallest set of
 * rectangles, so repeated strokes do not pile up details.
 */
export function paintTexels(design: ModelDesign, strokes: PaintStroke[], color: string | null): ModelEditResult {
  if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) return { ok: false, message: "颜色格式无效。" }
  const next = clone(design)
  let changed = false
  for (const stroke of strokes) {
    const cube = findCube(next, stroke.part)
    if (!cube) return { ok: false, message: "找不到要绘制的方块。" }
    const [width, height] = faceSize(cube.size, stroke.face, next.texel_size ?? 1)
    // On a painted cube no colour is the face itself: every texel painted is kept as painted.
    const base = paintedCube(next, stroke.part) ? null : cube.faces[stroke.face].toLowerCase()
    const grid: (string | null)[][] = Array.from({ length: height }, () => Array<string | null>(width).fill(null))
    cube.surface_details
      .filter((detail) => detail.face === stroke.face)
      .forEach((detail) => {
        for (let y = detail.y; y < Math.min(height, detail.y + detail.height); y++)
          for (let x = detail.x; x < Math.min(width, detail.x + detail.width); x++) grid[y]![x] = detail.color.toLowerCase()
      })
    const paint = color?.toLowerCase() ?? null
    stroke.texels.forEach(({ x, y }) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return
      const value = paint === base ? null : paint
      if (grid[y]![x] !== value) changed = true
      grid[y]![x] = value
    })
    if (base) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (grid[y]![x] === base) grid[y]![x] = null
    cube.surface_details = [
      ...cube.surface_details.filter((detail) => detail.face !== stroke.face),
      ...rectangles(grid, width, height).map((rect) => ({ face: stroke.face, ...rect })),
    ]
    if (cube.surface_details.length > 64)
      return { ok: false, message: "这个方块上的花纹太碎了（最多 64 块色块），试试用整面填充或更大块的图案。" }
  }
  if (!changed) return { ok: false, message: "" }
  return finish(next, "这次绘制无法保存。")
}

/** Repaint a whole face with one colour and clear its details. */
export function fillFace(design: ModelDesign, part: string, face: FaceName, color: string): ModelEditResult {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { ok: false, message: "颜色格式无效。" }
  const next = clone(design)
  const cube = findCube(next, part)
  if (!cube) return { ok: false, message: "找不到要填充的方块。" }
  const hadDetails = cube.surface_details.some((detail) => detail.face === face)
  // A painted cube shows its material where its face colour would be: the face is covered whole instead, the way the brush paints.
  if (paintedCube(next, part)) {
    const [width, height] = faceSize(cube.size, face, next.texel_size ?? 1)
    const whole = cube.surface_details.filter((detail) => detail.face === face)
    if (whole.length === 1 && whole[0]!.x === 0 && whole[0]!.y === 0 && whole[0]!.width === width && whole[0]!.height === height && whole[0]!.color.toLowerCase() === color.toLowerCase()) return { ok: false, message: "" }
    cube.surface_details = [...cube.surface_details.filter((detail) => detail.face !== face), { face, x: 0, y: 0, width, height, color: color.toLowerCase() }]
    return finish(next, "填充后模型无法保存。")
  }
  if (!hadDetails && cube.faces[face].toLowerCase() === color.toLowerCase()) return { ok: false, message: "" }
  cube.faces[face] = color.toLowerCase()
  cube.surface_details = cube.surface_details.filter((detail) => detail.face !== face)
  return finish(next, "填充后模型无法保存。")
}

/* ---------- Animation keyframes ---------- */

type Rotation = Bone["rotation"]
const roundTime = (value: number) => Math.round(value * 100) / 100
const roundAngle = (value: number) => Math.round(value * 10) / 10
const sameTime = (a: number, b: number) => Math.abs(a - b) < 0.005

/** Add a keyframe for one part at `time`, or replace the one already there. */
export function setKeyframe(
  design: ModelDesign,
  animationName: string,
  bone: string,
  time: number,
  rotation: Rotation,
): ModelEditResult {
  const next = clone(design)
  const animation = next.animations.find((value) => value.name === animationName)
  if (!animation) return { ok: false, message: "找不到这个动作。" }
  if (!next.bones.some((value) => value.name === bone)) return { ok: false, message: "找不到这个部件。" }
  const at = roundTime(Math.min(Math.max(time, 0), animation.length))
  const value = rotation.map((angle) => roundAngle(Math.min(360, Math.max(-360, angle)))) as Rotation
  let channel = animation.channels.find((item) => item.bone === bone)
  if (!channel) {
    if (animation.channels.length >= tierOf(next.budget).bones) return { ok: false, message: `这个动作控制的部件已经达到「${tierOf(next.budget).name}」档的上限（${tierOf(next.budget).bones} 个）。` }
    channel = { bone, keyframes: [] }
    animation.channels.push(channel)
  }
  const existing = channel.keyframes.find((frame) => sameTime(frame.time, at))
  if (existing) existing.rotation = value
  else {
    if (channel.keyframes.length >= tierOf(next.budget).keys) return { ok: false, message: `这个部件的关键帧已经达到 ${tierOf(next.budget).keys} 个上限。` }
    channel.keyframes.push({ time: at, rotation: value })
    channel.keyframes.sort((a, b) => a.time - b.time)
  }
  return finish(next, "这个关键帧无法保存。")
}

/** Remove the keyframe of one part at `time`. */
export function deleteKeyframe(design: ModelDesign, animationName: string, bone: string, time: number): ModelEditResult {
  const next = clone(design)
  const animation = next.animations.find((value) => value.name === animationName)
  const channel = animation?.channels.find((item) => item.bone === bone)
  if (!animation || !channel || !channel.keyframes.some((frame) => sameTime(frame.time, time)))
    return { ok: false, message: "这一刻没有这个部件的关键帧。" }
  channel.keyframes = channel.keyframes.filter((frame) => !sameTime(frame.time, time))
  // A part that still moves or scales keeps its channel.
  if (!channel.keyframes.length && !channel.position?.length && !channel.scale?.length) animation.channels = animation.channels.filter((item) => item !== channel)
  if (!animation.channels.length) return { ok: false, message: "动作至少要保留一个关键帧。" }
  return finish(next, "删除后动作无法保存。")
}

/** Change a motion's length or looping. Keyframes past a shorter end are dropped. */
export function setAnimationTiming(
  design: ModelDesign,
  animationName: string,
  timing: { length?: number; loop?: boolean },
): ModelEditResult {
  const next = clone(design)
  const animation = next.animations.find((value) => value.name === animationName)
  if (!animation) return { ok: false, message: "找不到这个动作。" }
  if (timing.length !== undefined) {
    if (!(timing.length > 0) || timing.length > 30) return { ok: false, message: "动作时长需要在 0.05 到 30 秒之间。" }
    animation.length = Math.max(0.05, roundTime(timing.length))
    animation.channels = animation.channels
      .map((channel) => ({
        ...channel,
        keyframes: channel.keyframes.filter((frame) => frame.time <= animation.length),
        ...(channel.position ? { position: channel.position.filter((frame) => frame.time <= animation.length) } : {}),
        ...(channel.scale ? { scale: channel.scale.filter((frame) => frame.time <= animation.length) } : {}),
      }))
      .filter((channel) => channel.keyframes.length || channel.position?.length || channel.scale?.length)
    if (!animation.channels.length) return { ok: false, message: "这么短会删掉全部关键帧。" }
  }
  if (timing.loop !== undefined) animation.loop = timing.loop
  return finish(next, "动作时长无法保存。")
}

/** Keyframe times of a motion, for one part or (without `bone`) for all parts. */
export function keyframeTimes(design: ModelDesign, animationName: string, bone?: string) {
  const animation = design.animations.find((value) => value.name === animationName)
  const times = (animation?.channels ?? [])
    .filter((channel) => !bone || channel.bone === bone)
    .flatMap((channel) => channel.keyframes.map((frame) => frame.time))
  return [...new Set(times.map(roundTime))].sort((a, b) => a - b)
}

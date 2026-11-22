import type { ImportedAsset } from "@minemods/mod-core/import-assets"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { mountViewport, type Preview, type ViewportCameraState } from "../viewport"

const thumbnailCache = new Map<string, string | null>()
const thumbnailPending = new Map<string, Promise<string | null>>()
const thumbnailWaiters: (() => void)[] = []
let thumbnailCacheBytes = 0
let thumbnailReads = 0

async function thumbnailSlot<T>(operation: () => Promise<T>) {
  if (thumbnailReads >= 3) await new Promise<void>((resolve) => thumbnailWaiters.push(resolve))
  thumbnailReads++
  try {
    return await operation()
  } finally {
    thumbnailReads--
    thumbnailWaiters.shift()?.()
  }
}

function cacheThumbnail(key: string, value: string | null) {
  const previous = thumbnailCache.get(key)
  if (previous) thumbnailCacheBytes -= previous.length * 2
  thumbnailCache.delete(key)
  thumbnailCache.set(key, value)
  if (value) thumbnailCacheBytes += value.length * 2
  while (thumbnailCache.size > 320 || thumbnailCacheBytes > 24 * 1024 * 1024) {
    const oldest = thumbnailCache.keys().next().value!
    const content = thumbnailCache.get(oldest)
    if (content) thumbnailCacheBytes -= content.length * 2
    thumbnailCache.delete(oldest)
  }
  return value
}

/** Only PNG files with a sane header and size are shown as images. */
export function safeImageMime(path: string, content: string) {
  const extension = path.match(/\.([^.]+)$/)?.[1].toLowerCase()
  if (extension !== "png" || content.length > 18_000_000) return
  const bytes = Uint8Array.from(atob(content.slice(0, 64)), (character) => character.charCodeAt(0))
  if (bytes.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return
  const width = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16)
  const height = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20)
  if (width > 8192 || height > 8192 || width * height > 16_000_000) return
  return "image/png"
}

/** A texture asset as a data URL, or null when it cannot be shown. Cached and rate limited. */
export function readThumbnail(id: string, asset: Pick<ImportedAsset, "id" | "sha256" | "path">) {
  const key = `${id}\0${asset.id}\0${asset.sha256}`
  if (thumbnailCache.has(key)) return Promise.resolve(thumbnailCache.get(key) ?? null)
  if (thumbnailPending.has(key)) return thumbnailPending.get(key)!
  const pending = thumbnailSlot(async () => {
    const file = await window.studio.readImportedAssetFile({ id, assetId: asset.id })
    if (file.encoding !== "base64" || file.truncated) return cacheThumbnail(key, null)
    const mime = safeImageMime(asset.path, file.content)
    return cacheThumbnail(key, mime ? `data:${mime};base64,${file.content}` : null)
  })
    .catch(() => cacheThumbnail(key, null))
    .finally(() => thumbnailPending.delete(key))
  thumbnailPending.set(key, pending)
  return pending
}

/** Crop the transparent margin so the model fills its slot. */
async function trimPicture(source: string) {
  const image = new Image()
  image.src = source
  await image.decode()
  const canvas = document.createElement("canvas")
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext("2d")
  if (!context) return source
  context.drawImage(image, 0, 0)
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
  const box = { left: width, top: height, right: -1, bottom: -1 }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! < 8) continue
      box.left = Math.min(box.left, x)
      box.right = Math.max(box.right, x)
      box.top = Math.min(box.top, y)
      box.bottom = Math.max(box.bottom, y)
    }
  if (box.right < box.left) return source
  const side = Math.max(box.right - box.left + 1, box.bottom - box.top + 1)
  const output = document.createElement("canvas")
  output.width = output.height = side
  output
    .getContext("2d")
    ?.drawImage(
      canvas,
      box.left,
      box.top,
      box.right - box.left + 1,
      box.bottom - box.top + 1,
      Math.floor((side - (box.right - box.left + 1)) / 2),
      Math.floor((side - (box.bottom - box.top + 1)) / 2),
      box.right - box.left + 1,
      box.bottom - box.top + 1,
    )
  return output.toDataURL("image/png")
}

let snapshotTail: Promise<unknown> = Promise.resolve()

/** Render a model from the default camera angle into a transparent PNG. One at a time: each uses a WebGL context. */
export function snapshotModel(model: ModelDesign, preview: Preview | null, size = 256, time = 0, shot: { animation?: string; camera?: ViewportCameraState } = {}) {
  const work = snapshotTail.then(async () => {
    const host = document.createElement("div")
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${size}px;height:${size}px;pointer-events:none`
    host.setAttribute("aria-hidden", "true")
    document.body.append(host)
    const viewport = mountViewport(host, model, preview, () => undefined, { icon: true, time, ...shot })
    try {
      return await trimPicture(await viewport.capture())
    } finally {
      viewport.dispose()
      host.remove()
    }
  })
  snapshotTail = work.catch(() => undefined)
  return work
}

const modelIconPending = new Map<string, Promise<string | null>>()

/** The default-view picture of an imported model asset, or null when it has no static geometry. */
export function readModelIcon(id: string, asset: Pick<ImportedAsset, "id" | "sha256">) {
  const key = `${id}\0model\0${asset.id}\0${asset.sha256}`
  if (thumbnailCache.has(key)) return Promise.resolve(thumbnailCache.get(key) ?? null)
  if (modelIconPending.has(key)) return modelIconPending.get(key)!
  const pending = window.studio
    .previewImportedAsset({ id, assetId: asset.id })
    .then((result) => (result.model ? snapshotModel(result.model, result.preview as Preview | null) : null))
    .then((image) => cacheThumbnail(key, image))
    .catch(() => cacheThumbnail(key, null))
    .finally(() => modelIconPending.delete(key))
  modelIconPending.set(key, pending)
  return pending
}

/** The default-view picture of a creature of an imported mod. `stamp` changes when the mod's content does. */
export function readEntityIcon(id: string, entity: string, stamp: string) {
  const key = `${id}\0entity\0${entity}\0${stamp}`
  if (thumbnailCache.has(key)) return Promise.resolve(thumbnailCache.get(key) ?? null)
  if (modelIconPending.has(key)) return modelIconPending.get(key)!
  const pending = window.studio
    .previewImportedEntity({ id, entity })
    .then((result) => (result.model ? snapshotModel(result.model, result.preview as Preview | null) : null))
    .then((image) => cacheThumbnail(key, image))
    .catch(() => cacheThumbnail(key, null))
    .finally(() => modelIconPending.delete(key))
  modelIconPending.set(key, pending)
  return pending
}

type FlatAsset = Pick<ImportedAsset, "id" | "sha256" | "path" | "resourcePath">
const modelJson = new Map<string, Promise<Record<string, unknown> | null>>()

function readModelJson(id: string, asset: FlatAsset) {
  const key = `${id}\0${asset.id}\0${asset.sha256}`
  const cached = modelJson.get(key)
  if (cached) return cached
  const pending = window.studio
    .readImportedAssetFile({ id, assetId: asset.id })
    .then((file) => {
      if (file.encoding !== "utf8" || file.truncated) return null
      const value: unknown = JSON.parse(file.content)
      return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
    })
    .catch(() => null)
  modelJson.set(key, pending)
  if (modelJson.size > 2000) modelJson.delete(modelJson.keys().next().value!)
  return pending
}

const resourceFile = (reference: string, folder: "models" | "textures", extension: string) => {
  const [namespace, path] = reference.includes(":") ? reference.split(":") : ["minecraft", reference]
  return `assets/${namespace}/${folder}/${path}.${extension}`
}

async function loadPicture(source: string) {
  const image = new Image()
  image.src = source
  await image.decode()
  return image
}

/** Three faces of a cube, the way an inventory shows a block. Animated textures use their first frame. */
function drawBlock(top: HTMLImageElement, left: HTMLImageElement, right: HTMLImageElement) {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 64
  const context = canvas.getContext("2d")
  if (!context) return null
  context.imageSmoothingEnabled = false
  // Each face is drawn on its own layer so its shading never touches another face.
  const layer = (image: HTMLImageElement, origin: [number, number], u: [number, number], v: [number, number], shade: number) => {
    const piece = document.createElement("canvas")
    piece.width = piece.height = 64
    const own = piece.getContext("2d")
    if (!own) return
    own.imageSmoothingEnabled = false
    const size = image.width
    own.setTransform(u[0] / size, u[1] / size, v[0] / size, v[1] / size, origin[0], origin[1])
    own.drawImage(image, 0, 0, size, size, 0, 0, size, size)
    if (shade) {
      own.globalCompositeOperation = "source-atop"
      own.fillStyle = `rgba(0, 0, 0, ${shade})`
      own.fillRect(0, 0, size, size)
    }
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.drawImage(piece, 0, 0)
  }
  layer(top, [0, 16], [32, -16], [32, 16], 0)
  layer(left, [0, 16], [32, 16], [0, 32], 0.2)
  layer(right, [32, 32], [32, -16], [0, 32], 0.42)
  return canvas.toDataURL("image/png")
}

/**
 * An inventory-style picture from a block or item model's textures alone. It follows the model's
 * parents inside the mod and needs no vanilla files: a flat sprite for items and plants, a cube for blocks.
 */
export function readFlatModelIcon(id: string, asset: FlatAsset, files: Map<string, FlatAsset>) {
  const key = `${id}\0flat\0${asset.id}\0${asset.sha256}`
  if (thumbnailCache.has(key)) return Promise.resolve(thumbnailCache.get(key) ?? null)
  if (modelIconPending.has(key)) return modelIconPending.get(key)!
  const pending = (async () => {
    const textures: Record<string, string> = {}
    let current: FlatAsset | undefined = asset
    let root = ""
    for (let depth = 0; current && depth < 8; depth++) {
      const json = await readModelJson(id, current)
      if (!json) break
      if (typeof json.textures === "object" && json.textures !== null)
        Object.entries(json.textures as Record<string, unknown>).forEach(([name, value]) => {
          if (typeof value === "string" && !(name in textures)) textures[name] = value
        })
      root = typeof json.parent === "string" ? json.parent : ""
      current = root ? files.get(resourceFile(root, "models", "json")) : undefined
    }
    const picture = async (...names: string[]) => {
      for (const name of names) {
        let reference = textures[name]
        for (let hop = 0; reference?.startsWith("#") && hop < 8; hop++) reference = textures[reference.slice(1)]
        const file = reference && !reference.startsWith("#") ? files.get(resourceFile(reference, "textures", "png")) : undefined
        const source = file && (await readThumbnail(id, file))
        if (source) return source
      }
      return null
    }
    const flat = /generated|handheld|cross|plant|flower|sapling|torch|rail|ladder|vine/.test(root)
    const sprite = await picture("layer0", ...(flat ? ["cross", "plant", "texture", "torch", "rail", "particle"] : []))
    if (sprite) return sprite
    const top = await picture("up", "top", "end", "all", "texture", "particle", "side")
    const side = await picture("side", "all", "north", "south", "east", "west", "wall", "texture", "particle", "end")
    const front = await picture("front", "south", "side", "all", "east", "texture", "particle", "end")
    if (!top || !side) return null
    const [first, second, third] = await Promise.all([loadPicture(top), loadPicture(side), loadPicture(front ?? side)])
    return drawBlock(first, second, third)
  })()
    .then((image) => cacheThumbnail(key, image))
    .catch(() => cacheThumbnail(key, null))
    .finally(() => modelIconPending.delete(key))
  modelIconPending.set(key, pending)
  return pending
}

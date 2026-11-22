import { calm } from "./calm"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { compileModel } from "@minemods/mod-core/model"
import { geckoBonePosition, geckoRotation, geckoRotationOrder } from "./model-transform"
import { fitBoxView } from "./box-fit"
import { orbitWheel } from "./orbit-wheel"
import { previewFaceUV } from "./model-core/blockbench-uv"
import { sampleBone } from "./model-core/animation"
import { programClip } from "@minemods/studio-ai/program-clip"
import { clipPace } from "@minemods/studio-ai/motion-continuity"
import { previewCubePose, previewBonePosition, sampleCompiledTrack, type CompiledTrack } from "./model-core/pose"
import { explodeVector } from "./model-core/geometry"
import { paintedPreview } from "./model-paint-preview"
import { faceRectCenter, texelAt, type FaceName, type PaintStroke, type Vec3 } from "./model-edit"

// Where the camera stands when it frames a thing by itself: a quarter view from the front, a little above.
const VIEW_FROM = [42, 18, -47] as const

export type ViewportBox = { min: [number, number, number]; max: [number, number, number]; color: string }

export type Preview = {
  geometry: ReturnType<typeof compileModel>["geometry"]
  faceUvSpace?: "editor"
  textureDataUrl: string
  animation?: ReturnType<typeof compileModel>["animation"]
  /** Creature skins: cut out like the game draws them, or blended see-through. Absent keeps the editor's soft edges. */
  look?: { blend: boolean; opacity: number }
}

/** `fov` (vertical degrees) is for a view from inside the model, like a player's own eyes; left out, the lens stays the usual one. */
export type ViewportCameraState = { position: [number, number, number]; target: [number, number, number]; fov?: number }
export type ViewportSnapshot = { dataUrl: string; width: number; height: number }
/** Paint mode: left button paints texels, right button orbits. `color` null erases to the face colour. */
export type ViewportPaint = { color: string | null; continuous: boolean }
type ViewportOptions = {
  paint?: ViewportPaint | null
  onStroke?: (strokes: PaintStroke[]) => void
  exploded?: boolean
  /** Start paused at this time (seconds) instead of playing. */
  time?: number | null
  /** Called every frame with the animation cursor, for timelines. */
  onTick?: (time: number) => void
  animation?: string
  playing?: boolean
  onSelectPart?: (part: string) => void
  camera?: ViewportCameraState
  /** The person is turning this view: told each change, so another view can stand at the same angle. */
  onCamera?: (state: ViewportCameraState) => void
  /** Icon mode: transparent background, no ground or grid, for `capture()` snapshots. */
  icon?: boolean
  /** Looks: the whole model moved by this (model pixels, this view's space), e.g. a creature standing somewhere other than its origin. */
  offset?: [number, number, number]
  /**
   * Looks: further models drawn into the same view, each moved by its own `offset`, in the same depth buffer (so they hide and are hidden by the model and each other).
   * Each is posed by its own motion of that name (`options.animation`), or its first, at the same moment as the model.
   */
  parts?: { design: ModelDesign; preview: Preview | null; offset: [number, number, number] }[]
}
type CompiledCube = {
  origin?: [number, number, number]
  size?: [number, number, number]
  scale?: [number, number, number]
  inflate?: number
  pivot?: [number, number, number]
  rotation?: [number, number, number]
  uv: Record<string, { uv: number[]; uv_size: number[]; rotation?: number; uv_rotation?: number; visible?: boolean }>
}

// texel_size 2 or 4: one texel of a face covers that many model units a side, and the last one in a row is cut by the face's edge.
function texelRectOf(texelEvery: number, size: readonly number[], rect: { face: FaceName; x: number; y: number; width: number; height: number }) {
  if (texelEvery === 1) return rect
  const [across, down] = rect.face === "up" || rect.face === "down" ? [size[0]!, size[2]!] : rect.face === "east" || rect.face === "west" ? [size[2]!, size[1]!] : [size[0]!, size[1]!]
  const x = Math.min(rect.x * texelEvery, across)
  const y = Math.min(rect.y * texelEvery, down)
  return { ...rect, x, y, width: Math.max(0.01, Math.min((rect.x + rect.width) * texelEvery, across) - x), height: Math.max(0.01, Math.min((rect.y + rect.height) * texelEvery, down) - y) }
}

const faceOrder = ["east", "west", "up", "down", "south", "north"] as const

/** What a model needs to be posed: one group a bone, where each sits when built, and the compiled tracks of its preview. */
type Built = ReturnType<typeof buildModel>

/**
 * One model's bones and cubes under `parent`: a group a bone, a mesh a cube, the texture it wears. The viewport builds its own model with this and, for looks,
 * every further model that is drawn into the same view.
 */
function buildModel(design: ModelDesign, preview: Preview | null, parent: THREE.Object3D) {
  const groups = new Map(design.bones.map((bone) => [bone.name, new THREE.Group()]))
  const basePositions = new Map<string, [number, number, number]>()
  const targets: THREE.Mesh[] = []
  let textureSettled = () => {}
  const textureLoaded = new Promise<void>((resolve) => (textureSettled = resolve))
  const texture = preview?.textureDataUrl
    ? new THREE.TextureLoader().load(
        preview.textureDataUrl,
        () => textureSettled(),
        undefined,
        () => textureSettled(),
      )
    : null
  if (!texture) textureSettled()
  const texelEvery = design.texel_size ?? 1
  const textureSize: [number, number] = [
    preview?.geometry["minecraft:geometry"][0]?.description.texture_width ?? design.texture_size,
    preview?.geometry["minecraft:geometry"][0]?.description.texture_height ?? design.texture_size,
  ]
  if (texture) {
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.colorSpace = THREE.SRGBColorSpace
  }
  design.bones.forEach((bone, boneIndex) => {
    const group = groups.get(bone.name)!
    const above = design.bones.find((item) => item.name === bone.parent)
    group.position.set(...geckoBonePosition(bone.pivot, above?.pivot))
    basePositions.set(bone.name, group.position.toArray() as [number, number, number])
    group.rotation.set(...geckoRotation(bone.rotation), geckoRotationOrder)
    if (bone.parent && groups.has(bone.parent)) groups.get(bone.parent)!.add(group)
    else parent.add(group)
    bone.cubes.forEach((cube, cubeIndex) => {
      const compiledCube = preview?.geometry["minecraft:geometry"][0]?.bones[boneIndex]?.cubes[cubeIndex] as
        | CompiledCube
        | undefined
      const cubePivot = new THREE.Group()
      const pose = previewCubePose(
        {
          ...cube,
          origin: compiledCube?.origin ?? cube.origin,
          size: compiledCube?.size ?? cube.size,
          // 第 1 步: a turned cube's own pivot and rotation, from the compiled file or (drawn without one) from the design itself.
          pivot: compiledCube ? compiledCube.pivot : cube.rotation?.some((value) => value !== 0) ? (cube.pivot ?? (cube.origin.map((value, axis) => value + cube.size[axis]! / 2) as [number, number, number])) : undefined,
          rotation: compiledCube ? compiledCube.rotation : (cube.rotation ?? undefined),
        },
        bone.pivot,
      )
      cubePivot.position.set(...pose.pivot)
      cubePivot.rotation.set(...pose.rotation, geckoRotationOrder)
      group.add(cubePivot)
      // 第 1 步: an inflated cube is drawn grown by its inflate on every side, its texture spread over the larger box (as GeckoLib does).
      const grown = compiledCube ? (compiledCube.inflate ?? 0) : (cube.inflate ?? 0)
      const geometry = new THREE.BoxGeometry(...((compiledCube?.size ?? cube.size).map((value) => value + grown * 2) as [number, number, number]))
      const materials = faceOrder.map((face, faceIndex) => {
        const rect = compiledCube?.uv[face]
        if (rect && texture) {
          const uv = geometry.getAttribute("uv")
          previewFaceUV(face, rect, textureSize, preview?.faceUvSpace).forEach((value, index) => uv.setXY(faceIndex * 4 + index, value[0], value[1]))
        }
        // Creature skins follow the game: cut out (a pixel is either there or not), or blended when the game blends them.
        const look = preview?.look
        return new THREE.MeshStandardMaterial({
          color: texture ? "#ffffff" : cube.faces[face],
          map: texture,
          transparent: look ? look.blend : true,
          alphaTest: look ? (look.blend ? 0.004 : 0.1) : 0.01,
          ...(look?.blend ? { opacity: look.opacity, depthWrite: look.opacity >= 1 } : {}),
          roughness: 1,
          visible: rect?.visible !== false,
        })
      })
      const mesh = new THREE.Mesh(geometry, materials)
      mesh.position.set(...pose.position)
      if (compiledCube?.scale) {
        mesh.scale.set(...compiledCube.scale)
        mesh.position.multiply(new THREE.Vector3(...compiledCube.scale))
      }
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData.bone = bone.name
      mesh.userData.part = `${bone.name}.${cube.name}`
      mesh.userData.size = cube.size
      mesh.userData.faces = cube.faces
      cubePivot.add(mesh)
      targets.push(mesh)
      if (!texture)
        cube.surface_details.forEach((detail) => {
          // A detail is written in texels; at texel_size 2 or 4 a texel covers that many model units a side (cut by the face's own edge).
          const shown = texelRectOf(texelEvery, cube.size, detail)
          const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(shown.width, shown.height),
            detailMaterial(detail.color),
          )
          orientFacePlane(plane, detail.face)
          plane.position.set(...faceRectCenter(cube.size, detail.face, shown, 0.012))
          plane.userData.bone = bone.name
          plane.userData.part = `${bone.name}.${cube.name}`
          mesh.add(plane)
        })
    })
  })
  return { groups, basePositions, targets, texture, textureLoaded, texelEvery }
}

/** The sample of one track of a compiled animation file, by the motion's name; undefined where the file has none. */
function compiledTrackOf(preview: Preview | null, name: string, bone: string, channel: "rotation" | "position" | "scale", time: number) {
  const compiledAnimations = preview?.animation?.animations as
    | Record<string, { bones?: Record<string, Partial<Record<"rotation" | "position" | "scale", CompiledTrack>>> }>
    | undefined
  const source = Object.entries(compiledAnimations ?? {}).find(([key]) => key.endsWith(`.${name}`))?.[1]?.bones?.[bone]?.[channel]
  return sampleCompiledTrack(source, time)
}

type Clip = ModelDesign["animations"][number]
// 第 2 步: a clip with its follow bones swaying (`followClip`), worked out once for each clip of each design shown.
const swayed = new WeakMap<Clip, { design: ModelDesign; clip: Clip }>()
/** The clip as it is shown: with the sway of the model's follow bones (a walk carried forwards at its own pace), or the very clip when it has none. */
function shownClip(design: ModelDesign, clip: Clip): Clip {
  if (!design.follow?.length && !design.sway?.length) return clip
  const known = swayed.get(clip)
  if (known?.design === design) return known.clip
  const made = programClip(design, clip, clip.name === "walk" ? clipPace(design, clip).speed : 0)
  swayed.set(clip, { design, clip: made })
  return made
}

/** Put every bone of a built model in the pose of `clip` at `cursor` seconds. */
function poseModel(built: Built, design: ModelDesign, preview: Preview | null, written: Clip, cursor: number, explodeOffsets: Map<string, [number, number, number]>) {
  const clip = shownClip(design, written)
  const follows = new Set((design.follow ?? []).map((follow) => follow.bone))
  design.bones.forEach((bone) => {
    // A compiled animation file, when the preview has one, is what the game will play; the document's own clip
    // (the animation contract) fills in every track that file does not carry. The two agree by construction.
    // A follow bone's turn is the clip's with its sway, which no file carries: the game works it out as it plays (`StudioPose`).
    const own = sampleBone(clip, bone.name, cursor)
    const sampled = (follows.has(bone.name) ? undefined : compiledTrackOf(preview, clip.name, bone.name, "rotation", cursor)) ?? own?.rotation
    const position = compiledTrackOf(preview, clip.name, bone.name, "position", cursor) ?? own?.position
    const scale = compiledTrackOf(preview, clip.name, bone.name, "scale", cursor) ?? own?.scale
    const target = built.groups.get(bone.name)!
    const base = built.basePositions.get(bone.name) ?? [0, 0, 0]
    target.position.set(...previewBonePosition(base, explodeOffsets.get(bone.name) ?? [0, 0, 0], position))
    target.scale.set(scale?.[0] ?? 1, scale?.[1] ?? 1, scale?.[2] ?? 1)
    built.groups.get(bone.name)!.rotation.set(...geckoRotation(bone.rotation, sampled), geckoRotationOrder)
  })
}

/** The motion of that name, else an `idle`, else the first; null for a model without any. */
const motionOf = (design: ModelDesign, name: string | undefined) => design.animations.find((item) => item.name === name) ?? design.animations.find((item) => item.name === "idle") ?? design.animations[0] ?? null

// Adjacent tabs unmount one canvas and mount the next in the same turn.
// Keep a normal canvas available for that turn, then release its GPU context.
let releasedRenderer: THREE.WebGLRenderer | undefined

export function mountViewport(
  host: HTMLElement,
  design: ModelDesign,
  given: Preview | null,
  onSelect: (bone: string) => void,
  options: ViewportOptions = {},
) {
  // A model painted by material has no flat face colours worth showing: draw its texture here when no one compiled it.
  const preview = given ?? paintedPreview(design)
  const scene = new THREE.Scene()
  const themeColor = (name: string, fallback: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  scene.background = new THREE.Color(themeColor("--viewport-bg", "#f0ede6"))
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 300)
  const icon = options.icon === true
  const renderer = (!icon && releasedRenderer) || new THREE.WebGLRenderer({ antialias: true, alpha: icon, preserveDrawingBuffer: icon })
  if (!icon) releasedRenderer = undefined
  const listeners = new AbortController()
  let disposed = false
  renderer.setPixelRatio(icon ? 1 : Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.setAttribute("aria-label", "模型的三维外观，可拖动或按方向键旋转，按住 Ctrl 滚动可缩放")
  host.append(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.maxPolarAngle = Math.PI * 0.49
  const hemisphere = new THREE.HemisphereLight(
    themeColor("--viewport-sky", "#fffaf0"),
    themeColor("--viewport-hemi-ground", "#b8a891"),
    2.55,
  )
  scene.add(hemisphere)
  const light = new THREE.DirectionalLight(themeColor("--viewport-light", "#fffaf0"), 2.9)
  light.position.set(-15, 45, -25)
  light.castShadow = true
  light.shadow.mapSize.set(2048, 2048)
  light.shadow.camera.left = -35
  light.shadow.camera.right = 35
  light.shadow.camera.top = 35
  light.shadow.camera.bottom = -35
  light.shadow.normalBias = 0.04
  scene.add(light)
  scene.add(light.target)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    new THREE.ShadowMaterial({ color: themeColor("--viewport-ground", "#b7aa96"), opacity: 0.14 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.5
  ground.receiveShadow = true
  scene.add(ground)
  const grid = new THREE.GridHelper(
    100,
    50,
    themeColor("--viewport-grid-major", "#cfc4b4"),
    themeColor("--viewport-grid-minor", "#e2dbd0"),
  )
  grid.material.transparent = true
  grid.material.opacity = 0.46
  grid.position.y = -0.15
  scene.add(grid)
  // The model hangs from a group of its own, so a look can stand it somewhere other than the origin; every further model of a look hangs from one at its own offset.
  const modelRoot = new THREE.Group()
  modelRoot.position.set(...(options.offset ?? [0, 0, 0]))
  scene.add(modelRoot)
  const built = buildModel(design, preview, modelRoot)
  const { groups, basePositions, targets, texture, textureLoaded, texelEvery } = built
  const explodeOffsets = new Map<string, [number, number, number]>()
  const parts = (options.parts ?? []).map((part) => {
    const root = new THREE.Group()
    root.position.set(...part.offset)
    scene.add(root)
    return { ...part, root, built: buildModel(part.design, part.preview, root) }
  })
  const texelRect = (size: readonly number[], rect: { face: FaceName; x: number; y: number; width: number; height: number }) => texelRectOf(texelEvery, size, rect)
  const selection = targets[0] ? new THREE.BoxHelper(targets[0], themeColor("--viewport-selection", "#a26035")) : null
  if (selection) {
    selection.visible = false
    scene.add(selection)
  }
  const outlined: THREE.Box3Helper[] = []
  const outlineBoxes = (boxes: readonly ViewportBox[]) => {
    outlined.splice(0).forEach((helper) => {
      modelRoot.remove(helper)
      helper.dispose()
    })
    boxes.forEach(({ min, max, color }) => {
      const helper = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)), color)
      if (!Array.isArray(helper.material)) helper.material.depthTest = false
      helper.renderOrder = 2
      modelRoot.add(helper)
      outlined.push(helper)
    })
  }
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const applyThemeColors = () => {
    scene.background = new THREE.Color(themeColor("--viewport-bg", "#f0ede6"))
    hemisphere.color.set(themeColor("--viewport-sky", "#fffaf0"))
    hemisphere.groundColor.set(themeColor("--viewport-hemi-ground", "#b8a891"))
    light.color.set(themeColor("--viewport-light", "#fffaf0"))
    ;(ground.material as THREE.ShadowMaterial).color.set(themeColor("--viewport-ground", "#b7aa96"))
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material]
    gridMaterials.forEach((material, index) => {
      if (!(material instanceof THREE.LineBasicMaterial)) return
      material.color.set(themeColor(index === 0 ? "--viewport-grid-major" : "--viewport-grid-minor", "#cfc4b4"))
    })
    if (selection && selection.material instanceof THREE.LineBasicMaterial)
      selection.material.color.set(themeColor("--viewport-selection", "#a26035"))
  }
  applyThemeColors()
  if (icon) {
    scene.background = null
    grid.visible = false
    ground.visible = false
  }
  // 制作现场: the parts written last stand out, white and blinking slowly (held still when the person asked for less motion).
  const highlights: THREE.BoxHelper[] = []
  const targetsOf = (name: string) => targets.filter((mesh) => mesh.userData.part === name || mesh.userData.bone === name)
  const highlight = (names: readonly string[]) => {
    highlights.splice(0).forEach((helper) => {
      scene.remove(helper)
      helper.geometry.dispose()
      ;(helper.material as THREE.Material).dispose()
    })
    names.flatMap(targetsOf).forEach((mesh) => {
      const helper = new THREE.BoxHelper(mesh, 0xffffff)
      scene.add(helper)
      highlights.push(helper)
    })
  }
  // What the version before had and this one does not have yet: a white dashed box where it stood. Only drawn from a real place, never guessed.
  const ghostRoot = new THREE.Group()
  scene.add(ghostRoot)
  const clearGhosts = () => {
    ghostRoot.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) {
        node.geometry.dispose()
        ;(node.material as THREE.Material).dispose()
      }
    })
    ghostRoot.clear()
  }
  const ghosts = (before: ModelDesign | null, names: readonly string[]) => {
    clearGhosts()
    if (!before || !names.length) return
    const holder = new THREE.Group()
    const was = buildModel(before, null, holder)
    holder.updateMatrixWorld(true)
    names.forEach((name) => {
      const found = was.targets.filter((mesh) => mesh.userData.bone === name)
      if (!found.length) return
      const box = new THREE.Box3()
      found.forEach((mesh) => box.expandByObject(mesh))
      const size = box.getSize(new THREE.Vector3())
      const middle = box.getCenter(new THREE.Vector3())
      const shape = new THREE.BoxGeometry(Math.max(size.x, 0.01), Math.max(size.y, 0.01), Math.max(size.z, 0.01))
      const body = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }))
      body.position.copy(middle)
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(shape), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.6, gapSize: 0.4 }))
      lines.computeLineDistances()
      lines.position.copy(middle)
      ghostRoot.add(body, lines)
    })
    was.texture?.dispose()
    holder.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry.dispose()
    })
  }
  // The AI's hand is on this part: the view turns to it, keeping how far away and from which side the person is looking.
  const focusPart = (names: readonly string[]) => {
    const found = names.flatMap(targetsOf)
    if (!found.length) return
    const box = new THREE.Box3()
    found.forEach((mesh) => box.expandByObject(mesh))
    // Most of the way: the part stands near the middle and what it joins stays in the picture.
    const shift = box.getCenter(new THREE.Vector3()).sub(controls.target).multiplyScalar(0.6)
    camera.position.add(shift)
    controls.target.add(shift)
    controls.update()
    cameraLocked = true
  }
  const partAt = (x: number, y: number) => {
    raycaster.setFromCamera(new THREE.Vector2(x * 2 - 1, -(y * 2 - 1)), camera)
    const hit = raycaster.intersectObjects(targets)[0]
    return hit ? ((hit.object.userData.part ?? hit.object.userData.bone) as string) : null
  }
  // A part's box takes in what is attached beneath it: its group holds the parts below, and the edits move them all.
  const select = (name: string) => {
    if (!selection) return
    const target = groups.get(name) ?? targets.find((mesh) => mesh.userData.part === name)
    if (!target) {
      selection.visible = false
      return
    }
    selection.setFromObject(target)
    selection.visible = true
  }
  const setExploded = (value: boolean) => {
    design.bones.forEach((bone, index) => {
      const base = basePositions.get(bone.name) ?? [0, 0, 0]
      const amount = value ? Math.max(1.5, modelBoundsSize(design) * 0.08) : 0
      const offset = explodeVector(index, design.bones.length, amount)
      explodeOffsets.set(bone.name, offset)
      groups.get(bone.name)!.position.set(...previewBonePosition(base, offset))
    })
    scene.updateMatrixWorld(true)
  }
  let pointerDown: { x: number; y: number } | null = null
  let paint = options.paint ?? null
  const orbitButtons = { ...controls.mouseButtons }
  const applyPaintControls = () => {
    controls.mouseButtons = paint
      ? { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
      : { ...orbitButtons }
    renderer.domElement.style.cursor = paint ? "crosshair" : ""
    if (!paint) hover.visible = false
  }
  const hover = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
    new THREE.LineBasicMaterial({ color: themeColor("--viewport-selection", "#a26035"), depthTest: false }),
  )
  hover.renderOrder = 10
  hover.visible = false
  scene.add(hover)
  const hitTexel = (event: { clientX: number; clientY: number }) => {
    const bounds = renderer.domElement.getBoundingClientRect()
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    )
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(targets, true).find((value) => !(value.object instanceof THREE.LineSegments))
    if (!hit) return null
    const mesh = (targets.includes(hit.object as THREE.Mesh) ? hit.object : hit.object.parent) as THREE.Mesh
    if (!mesh?.userData.size) return null
    const local = mesh.worldToLocal(hit.point.clone())
    const texel = texelAt(mesh.userData.size, local.toArray() as Vec3, texelEvery)
    return { mesh, part: mesh.userData.part as string, ...texel }
  }
  const placeOnTexel = (object: THREE.Object3D, mesh: THREE.Mesh, face: FaceName, x: number, y: number, lift: number) => {
    if (object.parent !== mesh) mesh.add(object)
    orientFacePlane(object, face)
    const shown = texelRect(mesh.userData.size, { face, x, y, width: 1, height: 1 })
    object.scale.set(shown.width, shown.height, 1)
    object.position.set(...faceRectCenter(mesh.userData.size, face, shown, lift))
  }
  let stroke: Map<string, PaintStroke> | null = null
  const strokeMarks: THREE.Mesh[] = []
  const addToStroke = (hit: NonNullable<ReturnType<typeof hitTexel>>) => {
    if (!stroke || !paint) return
    const key = `${hit.part}|${hit.face}`
    const entry = stroke.get(key) ?? { part: hit.part, face: hit.face, texels: [] }
    if (entry.texels.some((texel) => texel.x === hit.x && texel.y === hit.y)) return
    entry.texels.push({ x: hit.x, y: hit.y })
    stroke.set(key, entry)
    if (!paint.continuous) return
    const mark = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      detailMaterial(paint.color ?? hit.mesh.userData.faces[hit.face]),
    )
    placeOnTexel(mark, hit.mesh, hit.face, hit.x, hit.y, 0.014)
    strokeMarks.push(mark)
  }
  const finishStroke = () => {
    if (!stroke) return
    const strokes = [...stroke.values()]
    stroke = null
    if (strokes.length) options.onStroke?.(strokes)
  }
  let lastPaint: { x: number; y: number } | null = null
  const down = (event: PointerEvent) => {
    pointerDown = { x: event.clientX, y: event.clientY }
    lastPaint = { x: event.clientX, y: event.clientY }
    if (!paint || event.button !== 0) return
    const hit = hitTexel(event)
    if (!hit) return
    renderer.domElement.setPointerCapture(event.pointerId)
    stroke = new Map()
    addToStroke(hit)
  }
  const move = (event: PointerEvent) => {
    if (!paint) return
    const hit = hitTexel(event)
    if (!hit) {
      hover.visible = false
      return
    }
    placeOnTexel(hover, hit.mesh, hit.face, hit.x, hit.y, 0.03)
    hover.visible = true
    if (!(stroke && paint.continuous && event.buttons & 1)) return
    // Fill the gap since the last pointer event so fast strokes stay continuous.
    const from = lastPaint ?? { x: event.clientX, y: event.clientY }
    const steps = Math.max(1, Math.ceil(Math.hypot(event.clientX - from.x, event.clientY - from.y) / 3))
    for (let step = 1; step <= steps; step++) {
      const t = step / steps
      const sample = hitTexel({ clientX: from.x + (event.clientX - from.x) * t, clientY: from.y + (event.clientY - from.y) * t })
      if (sample) addToStroke(sample)
    }
    lastPaint = { x: event.clientX, y: event.clientY }
  }
  const up = (event: PointerEvent) => {
    if (paint) {
      if (event.button === 0) finishStroke()
      return
    }
    if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 4) return
    const bounds = renderer.domElement.getBoundingClientRect()
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    )
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(targets)[0]
    if (hit) {
      select(hit.object.userData.part ?? hit.object.userData.bone)
      onSelect(hit.object.userData.bone)
      options.onSelectPart?.(hit.object.userData.part ?? hit.object.userData.bone)
    }
  }
  const leave = () => {
    hover.visible = false
  }
  renderer.domElement.addEventListener("pointerdown", down)
  renderer.domElement.addEventListener("pointermove", move)
  renderer.domElement.addEventListener("pointerup", up)
  renderer.domElement.addEventListener("pointerleave", leave)
  applyPaintControls()
  // The first fit happens before rendering: update bone ancestors before measuring child meshes.
  scene.updateMatrixWorld(true)
  const modelBounds = targets.reduce((bounds, target) => bounds.expandByObject(target), new THREE.Box3())
  if (targets.length === 0) modelBounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(2, 2, 2))
  const fitCamera = () => {
    // The box's own corners are fitted, not the sphere around it: a long strip or a tall creature was drawn small in a wide canvas.
    const frame = fitBoxView(
      modelBounds.min.toArray() as [number, number, number],
      modelBounds.max.toArray() as [number, number, number],
      camera.aspect,
      VIEW_FROM,
      camera.fov,
    )
    controls.target.set(...frame.target)
    controls.minDistance = frame.minDistance
    controls.maxDistance = frame.maxDistance
    camera.near = frame.near
    camera.far = frame.far
    camera.position.copy(controls.target).add(new THREE.Vector3(...VIEW_FROM).normalize().multiplyScalar(frame.distance))
    camera.lookAt(controls.target)
    camera.updateProjectionMatrix()
    ground.position.set(frame.center[0], frame.groundY, frame.center[2])
    grid.position.set(frame.center[0], frame.groundY + 0.05, frame.center[2])
    grid.scale.setScalar(Math.max(1, Math.ceil(frame.groundRadius / 24)))
    light.position.set(...frame.center).add(new THREE.Vector3(-0.75, 2.25, -1.25).multiplyScalar(frame.radius))
    light.target.position.set(...frame.center)
    light.shadow.camera.left = light.shadow.camera.bottom = -frame.radius * 1.5
    light.shadow.camera.right = light.shadow.camera.top = frame.radius * 1.5
    light.shadow.camera.near = Math.max(0.01, frame.radius * 0.01)
    light.shadow.camera.far = frame.radius * 10
    light.shadow.camera.updateProjectionMatrix()
  }
  const modelBoundsSize = (value: ModelDesign) =>
    Math.max(1, ...value.bones.flatMap((bone) => bone.cubes.map((cube) => Math.hypot(...cube.size))))
  fitCamera()
  let cameraLocked = false
  // Only the view the person's hand is on speaks, so two linked views do not answer each other for ever. The damping runs on a little after the hand lets go.
  let turning = 0
  controls.addEventListener("start", () => {
    cameraLocked = true
    turning = Number.POSITIVE_INFINITY
  })
  controls.addEventListener("end", () => {
    turning = performance.now() + 400
  })
  controls.addEventListener("change", () => {
    if (performance.now() < turning) options.onCamera?.({ position: camera.position.toArray() as [number, number, number], target: controls.target.toArray() as [number, number, number] })
  })
  // The arrow keys turn the view, for a person without a mouse in hand. They go no further than this: the page's own arrows (the next thing on the card) stay outside a focused view.
  if (!icon) {
    const TURN = Math.PI / 24
    renderer.domElement.tabIndex = 0
    renderer.domElement.addEventListener("keydown", (event) => {
      const turn = { ArrowLeft: [-TURN, 0], ArrowRight: [TURN, 0], ArrowUp: [0, -TURN], ArrowDown: [0, TURN] }[event.key]
      if (!turn) return
      event.preventDefault()
      event.stopPropagation()
      const round = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target))
      round.theta += turn[0]!
      round.phi = Math.max(0.1, Math.min(controls.maxPolarAngle, round.phi + turn[1]!))
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(round))
      cameraLocked = true
      turning = performance.now() + 400
      controls.update()
    }, { signal: listeners.signal })
  }
  if (options.camera) {
    camera.position.set(...options.camera.position)
    controls.target.set(...options.camera.target)
    camera.lookAt(controls.target)
    cameraLocked = true
  }
  // The camera of a look is placed by the caller around what it means to show; the clip plane was fitted to the model alone, so models further out must still be in front of it.
  if (options.camera && (parts.length || options.offset)) {
    scene.updateMatrixWorld(true)
    const everything = new THREE.Box3().expandByObject(modelRoot)
    parts.forEach((part) => everything.expandByObject(part.root))
    const farthest = [0, 1, 2, 3, 4, 5, 6, 7].map((corner) => camera.position.distanceTo(new THREE.Vector3(corner & 1 ? everything.max.x : everything.min.x, corner & 2 ? everything.max.y : everything.min.y, corner & 4 ? everything.max.z : everything.min.z)))
    // A twentieth past the farthest corner of what is in the view: the bounds are taken before the models are posed, and a limb or an effect swung out of the built pose must not land on the plane itself.
    camera.far = Math.max(camera.far, Math.max(...farthest) * 1.05)
    camera.updateProjectionMatrix()
  }
  if (options.camera?.fov) {
    camera.fov = options.camera.fov
    // Eyes sit inside the model, so what is close must not be cut away.
    camera.near = 0.5
    camera.updateProjectionMatrix()
    // Eyes stay where they were put: the orbit would also pull a level gaze off the horizon.
    controls.enableRotate = controls.enableZoom = controls.enablePan = false
  }
  if (options.exploded) setExploded(true)
  const releaseWheel = !icon && orbitWheel(host, renderer.domElement, controls, camera, () => {
    scene.updateMatrixWorld(true)
    const bounds = new THREE.Box3().expandByObject(modelRoot)
    parts.forEach((part) => bounds.expandByObject(part.root))
    return bounds.isEmpty() ? modelBounds : bounds
  })
  const resize = new ResizeObserver(() => {
    const width = Math.max(host.clientWidth, 1)
    const height = Math.max(host.clientHeight, 1)
    renderer.setSize(width, height)
    camera.aspect = width / height
    if (cameraLocked) camera.updateProjectionMatrix()
    else fitCamera()
  })
  resize.observe(host)
  let animation = motionOf(design, options.animation)
  let started = performance.now()
  let paused =
    options.playing === undefined ? calm() : !options.playing
  let pausedAt = 0
  if (typeof options.time === "number") {
    paused = true
    pausedAt = options.time
  }
  const noExplode = new Map<string, [number, number, number]>()
  const animate = (time: number) => {
    if (!options.camera?.fov) controls.update()
    highlights.forEach((helper) => {
      helper.update()
      helper.visible = calm() || Math.floor(time / 800) % 2 === 0
    })
    const elapsed = paused ? pausedAt : (time - started) / 1000
    // Further models of a look stand frozen in one pose each; they are posed at the same moment as the model.
    parts.forEach((part) => {
      const clip = motionOf(part.design, options.animation)
      if (clip) poseModel(part.built, part.design, part.preview, clip, clip.loop ? elapsed % clip.length : Math.min(elapsed, clip.length), noExplode)
    })
    if (!animation) {
      renderer.render(scene, camera)
      return
    }
    const cursor = animation.loop ? elapsed % animation.length : Math.min(elapsed, animation.length)
    options.onTick?.(cursor)
    poseModel(built, design, preview, animation, cursor, explodeOffsets)
    if (selection?.visible) selection.update()
    renderer.render(scene, camera)
  }
  renderer.setAnimationLoop(animate)
  return {
    hideBones(names: readonly string[]) { for (const [name, group] of groups) group.visible = !names.includes(name) },
    setVisible(visible:boolean) { renderer.setAnimationLoop(visible ? animate : null) },
    select,
    highlight,
    ghosts,
    outlineBoxes,
    focusPart,
    partAt,
    /** Where the view stands now, whoever put it there. */
    cameraNow: (): ViewportCameraState => ({ position: camera.position.toArray() as [number, number, number], target: controls.target.toArray() as [number, number, number] }),
    /** Stand at this angle, as another view or an earlier note did. */
    setCamera(state: ViewportCameraState) {
      camera.position.set(...state.position)
      controls.target.set(...state.target)
      controls.update()
      cameraLocked = true
    },
    /** Switch painting on or off without rebuilding the scene. */
    setPaint(next: ViewportPaint | null) {
      paint = next
      stroke = null
      applyPaintControls()
    },
    setAnimation(name: string) {
      animation = design.animations.find((item) => item.name === name) ?? animation
      started = performance.now()
      pausedAt = 0
    },
    setExploded,
    /** Start a motion from its beginning, also after the view was held still on a moment of it. Asked for by the person, so it plays whatever the setting for motion says. */
    resume(name?: string) {
      animation = design.animations.find((item) => item.name === name) ?? animation
      started = performance.now()
      pausedAt = 0
      paused = false
    },
    /** Pause and show the pose at `time` seconds. */
    seek(time: number) {
      paused = true
      pausedAt = time
    },
    togglePlaying() {
      if (!paused) pausedAt = (performance.now() - started) / 1000
      if (paused) started = performance.now() - pausedAt * 1000
      paused = !paused
      return !paused
    },
    resetCamera: () => {
      cameraLocked = false
      fitCamera()
    },
    /** Render one frame from the default angle and return it as a PNG data URL. */
    async capture() {
      await Promise.all([textureLoaded, ...parts.map((part) => part.built.textureLoaded)])
      if (disposed) throw new Error("模型视窗已更新，请重新截图。")
      const width = Math.max(host.clientWidth, 1)
      const height = Math.max(host.clientHeight, 1)
      renderer.setSize(width, height)
      camera.aspect = width / height
      fitCamera()
      animate(performance.now())
      return renderer.domElement.toDataURL("image/png")
    },
    /** Capture the actual view and pose the person is pointing at, without resetting their camera. */
    async captureCurrent(): Promise<ViewportSnapshot> {
      await Promise.all([textureLoaded, ...parts.map((part) => part.built.textureLoaded)])
      if (disposed) throw new Error("模型视窗已更新，请重新截图。")
      animate(performance.now())
      const source = renderer.domElement
      const ratio = Math.min(1, 1600 / Math.max(source.width, source.height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(source.width * ratio))
      canvas.height = Math.max(1, Math.round(source.height * ratio))
      const context = canvas.getContext("2d")
      if (!context) throw new Error("无法截取模型画面，请重试。")
      context.drawImage(source, 0, 0, canvas.width, canvas.height)
      return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height }
    },
    getCameraState: () =>
      cameraLocked
        ? {
            position: camera.position.toArray() as [number, number, number],
            target: controls.target.toArray() as [number, number, number],
          }
        : undefined,
    dispose() {
      if (disposed) return
      disposed = true
      listeners.abort()
      highlight([])
      clearGhosts()
      renderer.setAnimationLoop(null)
      resize.disconnect()
      if (releaseWheel) releaseWheel()
      controls.dispose()
      outlineBoxes([])
      renderer.domElement.removeEventListener("pointerdown", down)
      renderer.domElement.removeEventListener("pointermove", move)
      renderer.domElement.removeEventListener("pointerup", up)
      renderer.domElement.removeEventListener("pointerleave", leave)
      strokeMarks.length = 0
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
        }
      })
      texture?.dispose()
      parts.forEach((part) => part.built.texture?.dispose())
      light.shadow.dispose()
      renderer.renderLists.dispose()
      renderer.domElement.remove()
      if (icon || releasedRenderer) {
        renderer.dispose()
        renderer.forceContextLoss()
      } else {
        renderer.clear()
        releasedRenderer = renderer
        queueMicrotask(() => {
          if (releasedRenderer !== renderer) return
          releasedRenderer = undefined
          renderer.dispose()
          renderer.forceContextLoss()
        })
      }
    },
  }
}

/** Turn a PlaneGeometry (facing +z) so it lies flat on the given cube face, facing outward. */
function orientFacePlane(object: THREE.Object3D, face: FaceName) {
  object.rotation.set(0, 0, 0)
  if (face === "north") object.rotation.y = Math.PI
  if (face === "east") object.rotation.y = Math.PI / 2
  if (face === "west") object.rotation.y = -Math.PI / 2
  if (face === "up") object.rotation.x = -Math.PI / 2
  if (face === "down") object.rotation.x = Math.PI / 2
}

/** Surface details are lit like the face they sit on and always win the depth test against it. */
function detailMaterial(color: string) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
}

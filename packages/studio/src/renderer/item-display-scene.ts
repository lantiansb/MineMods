import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import type { Item } from "@minemods/mod-core/content"
import { compileItemModel } from "@minemods/mod-core/item-model"
import { itemDisplayPose, type ItemDisplaySlot, type ItemTransform } from "@minemods/mod-core/item-display"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { blockbenchFaceUV } from "./model-core/blockbench-uv"
import { orbitWheel } from "./orbit-wheel"

/** The same resting hand anchors used by Blockbench's Java display references (model pixels). */
export function itemHandAnchor(slot: ItemDisplaySlot) {
  const side = slot.endsWith("lefthand") ? -1 : 1
  const angle = Math.PI / 8
  return slot.startsWith("firstperson")
    ? { position: [side * 9.039, 15.682, 20.8] as [number, number, number], rotation: 0 }
    : { position: [side * 6, 22 - Math.cos(angle) * 10 + Math.sin(angle) * 2, -Math.sin(angle) * 10 - Math.cos(angle) * 2] as [number, number, number], rotation: -Math.PI / 2 + angle }
}

export function itemElementGeometry(element: ReturnType<typeof compileItemModel>["elements"][number]) {
  const geometry = new THREE.BoxGeometry(...element.to.map((value, axis) => value - element.from[axis]!) as [number, number, number])
  const uv = geometry.getAttribute("uv")
  ;["east", "west", "up", "down", "south", "north"].forEach((face, faceIndex) => {
    const rect = element.faces[face]!.uv as [number, number, number, number]
    blockbenchFaceUV(rect, [16, 16]).forEach((value, index) => uv.setXY(faceIndex * 4 + index, ...value))
  })
  return geometry
}

export function mountItemDisplay(host: HTMLElement, item: Item, design: ModelDesign | undefined, onError: (error: string) => void) {
  const model = design ? compileItemModel(design) : undefined
  const scene = new THREE.Scene()
  scene.background = new THREE.Color("#e9e5dd")
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500)
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.setAttribute("aria-label", `${item.name}持握时的三维外观，按住 Ctrl 滚动可缩放`)
  host.append(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  scene.add(new THREE.HemisphereLight("#ffffff", "#99938a", 2.4))
  const light = new THREE.DirectionalLight("#ffffff", 2.8)
  light.position.set(-25, 45, 30)
  scene.add(light)
  const grid = new THREE.GridHelper(80, 20, "#b3aa9a", "#d1cabb")
  scene.add(grid)
  const player = new THREE.Group()
  const skin = new THREE.MeshStandardMaterial({ color: "#c6a488", roughness: 1 })
  const shirt = new THREE.MeshStandardMaterial({ color: "#4a747e", roughness: 1 })
  const pants = new THREE.MeshStandardMaterial({ color: "#566276", roughness: 1 })
  const body = (size: [number, number, number], position: [number, number, number], bodyMaterial: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), bodyMaterial)
    mesh.position.set(...position)
    return mesh
  }
  player.add(body([8, 8, 8], [0, 28, 0], skin), body([8, 12, 4], [0, 18, 0], shirt), body([4, 12, 4], [2, 6, 0], pants), body([4, 12, 4], [-2, 6, 0], pants))
  const arms = [1, -1].map(side => {
    const group = new THREE.Group()
    group.position.set(side * 6, 22, 0)
    group.add(body([4, 4, 4], [0, 0, 0], shirt), body([4, 8, 4], [0, -6, 0], skin))
    player.add(group)
    return group
  })
  scene.add(player)
  const firstArm = body([3.5, 9, 3.5], [0, 0, 0], skin)
  scene.add(firstArm)
  const hand = new THREE.Group()
  const transform = new THREE.Group()
  hand.add(transform)
  scene.add(hand)
  const texture = model
    ? new THREE.DataTexture(model.texture.pixels, model.texture.size, model.texture.size, THREE.RGBAFormat)
    : new THREE.Texture()
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.flipY = true
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, alphaTest: 0.1, side: THREE.DoubleSide })
  let disposed = false
  if (model) {
    texture.needsUpdate = true
    model.elements.forEach(element => {
      const mesh = new THREE.Mesh(itemElementGeometry(element), material)
      mesh.position.set(...element.from.map((value, axis) => (value + element.to[axis]!) / 2 - 8) as [number, number, number])
      mesh.name = element.name
      transform.add(mesh)
    })
  } else {
    // Both faces and the edge use the actual item's PNG, including its alpha cutout.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(16, 16, 1), material)
    transform.add(mesh)
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 16
    const context = canvas.getContext("2d")!
    context.fillStyle = item.color
    context.fillRect(0, 0, 16, 16)
    texture.image = canvas
    texture.needsUpdate = true
    if (item.texture) {
      const image = new Image()
      image.onload = () => { if (!disposed) { texture.image = image; texture.needsUpdate = true } }
      image.onerror = () => { if (!disposed) onError("物品贴图无法读取，请重新保存 PNG 贴图。") }
      image.src = item.texture
    }
  }
  const releaseWheel = orbitWheel(host, renderer.domElement, controls, camera, () => {
    scene.updateMatrixWorld(true)
    return new THREE.Box3().expandByObject(player).expandByObject(hand)
  })
  let activeSlot: ItemDisplaySlot | undefined
  const resize = () => {
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera) })
  return {
    update(slot: ItemDisplaySlot, value: ItemTransform) {
      const first = slot.startsWith("firstperson")
      const side = slot.endsWith("lefthand") ? -1 : 1
      const anchor = itemHandAnchor(slot)
      const pose = itemDisplayPose(value, slot)
      hand.position.set(...anchor.position)
      hand.rotation.x = anchor.rotation
      transform.position.set(...pose.translation)
      transform.rotation.set(...pose.rotation, "XYZ")
      transform.scale.set(...pose.scale)
      player.visible = !first
      grid.visible = !first
      firstArm.visible = first
      firstArm.position.set(side * 8.8, 10, 23)
      firstArm.rotation.set(-0.45, 0, side * -0.18)
      arms.forEach((arm, index) => { arm.rotation.x = (index === 0 ? 1 : -1) === side ? Math.PI / 8 : 0 })
      controls.enabled = !first
      if (activeSlot !== slot) {
        camera.fov = first ? 70 : 40
        camera.position.set(...(first ? [0, 24, 32.4] : [-44, 40, -44]) as [number, number, number])
        controls.target.set(0, first ? 24 : 14, 0)
        controls.minDistance = 0
        controls.maxDistance = Infinity
        camera.lookAt(controls.target)
        camera.updateProjectionMatrix()
        controls.update()
      }
      activeSlot = slot
    },
    dispose() {
      disposed = true
      observer.disconnect()
      renderer.setAnimationLoop(null)
      releaseWheel()
      controls.dispose()
      scene.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) object.geometry.dispose() })
      skin.dispose(); shirt.dispose(); pants.dispose(); material.dispose(); texture.dispose()
      if (Array.isArray(grid.material)) grid.material.forEach(value => value.dispose())
      else grid.material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

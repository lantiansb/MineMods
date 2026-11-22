import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import * as THREE from "three"
import type { StudioView } from "../../api"
import type { Project } from "@minemods/mod-core/project"
import {
  fitModelBounds,
  geckoBonePosition,
  geckoCubePosition,
  geckoRotation,
  geckoRotationOrder,
} from "../model-transform"
import { Icon } from "../ui"

const cache = new Map<string, Promise<StudioView>>()
export function ProjectArt(props: { project?: Project }) {
  let host!: HTMLDivElement
  const [loaded, setLoaded] = createSignal(false)
  createEffect(() => {
    const project = props.project
    if (!project?.entities.some((entity) => entity.model_asset_id)) return
    let disposed = false
    let cleanup: (() => void) | undefined
    const key = `${project.id}:${project.revision}`
    if (!cache.has(key)) cache.set(key, window.studio.openProject(project.id))
    void cache
      .get(key)!
      .then((view) => {
        if (disposed || !view.preview) return
        const scene = new THREE.Scene()
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.outputColorSpace = THREE.SRGBColorSpace
        host.append(renderer.domElement)
        const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 500)
        const groups = new Map<string, THREE.Group>()
        const geometry = view.preview.geometry["minecraft:geometry"][0]!
        const themeColor = (name: string, fallback: string) =>
          getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
        const render = () => {
          if (!disposed) renderer.render(scene, camera)
        }
        const texture = new THREE.TextureLoader().load(view.preview.textureDataUrl, render)
        texture.magFilter = texture.minFilter = THREE.NearestFilter
        texture.colorSpace = THREE.SRGBColorSpace
        const hemisphere = new THREE.HemisphereLight(
          themeColor("--viewport-sky", "#fffaf0"),
          themeColor("--viewport-hemi-ground", "#b8a891"),
          2.7,
        )
        scene.add(hemisphere)
        const light = new THREE.DirectionalLight(themeColor("--viewport-light", "#fffaf0"), 2.6)
        light.position.set(-25, 60, -40)
        scene.add(light)
        geometry.bones.forEach((bone) => groups.set(bone.name, new THREE.Group()))
        geometry.bones.forEach((bone) => {
          const group = groups.get(bone.name)!
          const parent = geometry.bones.find((candidate) => candidate.name === bone.parent)
          group.position.set(...geckoBonePosition(bone.pivot, parent?.pivot))
          group.rotation.set(...geckoRotation(bone.rotation), geckoRotationOrder)
          if (bone.parent) groups.get(bone.parent)!.add(group)
          if (!bone.parent) scene.add(group)
          bone.cubes.forEach((cube) => {
            const shape = new THREE.BoxGeometry(...cube.size)
            const materials = (["east", "west", "up", "down", "south", "north"] as const).map((face, index) => {
              const rectangle = cube.uv[face]
              const uv = shape.getAttribute("uv")
              const u = rectangle.uv[0] / geometry.description.texture_width
              const v = 1 - rectangle.uv[1] / geometry.description.texture_height
              const w = rectangle.uv_size[0] / geometry.description.texture_width
              const h = rectangle.uv_size[1] / geometry.description.texture_height
              uv.setXY(index * 4, u, v)
              uv.setXY(index * 4 + 1, u + w, v)
              uv.setXY(index * 4 + 2, u, v - h)
              uv.setXY(index * 4 + 3, u + w, v - h)
              return new THREE.MeshStandardMaterial({
                map: texture,
                roughness: 0.9,
                transparent: true,
                alphaTest: 0.02,
              })
            })
            const mesh = new THREE.Mesh(shape, materials)
            const editable = cube as typeof cube & {
              pivot?: [number, number, number]
              rotation?: [number, number, number]
            }
            if (editable.rotation && editable.pivot) {
              const pivot = new THREE.Group()
              pivot.position.set(...geckoBonePosition(editable.pivot, bone.pivot))
              pivot.rotation.set(...geckoRotation(editable.rotation), geckoRotationOrder)
              mesh.position.set(...geckoCubePosition(cube.origin, cube.size, editable.pivot))
              pivot.add(mesh)
              group.add(pivot)
              return
            }
            mesh.position.set(...geckoCubePosition(cube.origin, cube.size, bone.pivot))
            group.add(mesh)
          })
        })
        scene.updateMatrixWorld(true)
        const bounds = new THREE.Box3().setFromObject(scene)
        const resize = new ResizeObserver(() => {
          const width = Math.max(host.clientWidth, 1)
          const height = Math.max(host.clientHeight, 1)
          renderer.setSize(width, height)
          camera.aspect = width / height
          const fit = fitModelBounds(
            bounds.min.toArray() as [number, number, number],
            bounds.max.toArray() as [number, number, number],
            camera.aspect,
          )
          camera.near = fit.near
          camera.far = fit.far
          camera.position
            .set(...fit.center)
            .add(new THREE.Vector3(42, 18, -47).normalize().multiplyScalar(fit.distance * 1.06))
          camera.lookAt(new THREE.Vector3(...fit.center))
          camera.updateProjectionMatrix()
          render()
        })
        resize.observe(host)
        setLoaded(true)
        cleanup = () => {
          resize.disconnect()
          scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              object.geometry.dispose()
              ;(Array.isArray(object.material) ? object.material : [object.material]).forEach((material) =>
                material.dispose(),
              )
            }
          })
          texture.dispose()
          renderer.dispose()
          renderer.domElement.remove()
        }
      })
      .catch(() => undefined)
    onCleanup(() => {
      disposed = true
      cleanup?.()
    })
  })
  return (
    <div class="project-art">
      <div ref={host} class="project-thumbnail" />
      <Show when={!loaded()}>
        <Show when={props.project?.blocks[0]} fallback={<Icon name="cube" />}>
          <div class="art-cube" style={{ "--art-color": props.project?.blocks[0]?.color ?? "#ab704a" }} />
        </Show>
      </Show>
    </div>
  )
}

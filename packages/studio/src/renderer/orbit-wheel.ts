import { Vector3, type Box3, type PerspectiveCamera } from "three"
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { FIT_MARGIN, fitBox } from "./box-fit"
import "./orbit-wheel.css"

const hint = "按住 Ctrl 滚动可缩放"
const seen = new WeakSet<HTMLElement>()

/** OrbitControls owns Ctrl + wheel; an unmodified wheel keeps the page's default scroll action. */
export function orbitWheel(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  controls: OrbitControls,
  camera: PerspectiveCamera,
  bounds: () => Box3,
) {
  const listeners = new AbortController()
  const signal = listeners.signal
  const note = document.createElement("span")
  note.className = "orbit-wheel-hint"
  note.textContent = hint
  host.classList.add("orbit-wheel-host")
  canvas.addEventListener("pointerenter", () => {
    if (seen.has(host) || !controls.enabled || !controls.enableZoom) return
    seen.add(host)
    host.append(note)
  }, { signal })
  canvas.addEventListener("pointerleave", () => note.remove(), { signal })
  canvas.addEventListener("wheel", (event) => {
    if (!event.ctrlKey) {
      event.stopImmediatePropagation()
      return
    }
    if (!controls.enabled || !controls.enableZoom) return
    const box = bounds()
    if (box.isEmpty()) return
    const direction = camera.position.clone().sub(controls.target).toArray()
    const frame = fitBox(box.min.toArray(), box.max.toArray(), camera.aspect, direction, camera.fov)
    const reach = Math.tan(camera.fov * Math.PI / 360) * Math.min(1, camera.aspect) / FIT_MARGIN
    const offset = controls.target.distanceTo(new Vector3(...frame.target))
    controls.minDistance = Math.max(0.1, frame.distance + offset * Math.hypot(1, 1 / reach))
    controls.maxDistance = controls.minDistance * 2.25
    camera.far = Math.max(camera.far, controls.maxDistance + box.getSize(new Vector3()).length())
    camera.updateProjectionMatrix()
  }, { capture: true, passive: true, signal })
  return () => {
    listeners.abort()
    note.remove()
    host.classList.remove("orbit-wheel-host")
  }
}

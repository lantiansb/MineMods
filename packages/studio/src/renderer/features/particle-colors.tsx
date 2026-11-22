import { For, Show } from "solid-js"

type Colour = { value: string; at?: number }

export function particleColourName(hex: string) {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const light = (max + min) / 2
  if (light > 0.95) return "白色"
  if (light < 0.08) return "黑色"
  if (delta < 0.08) return light < 0.35 ? "深灰色" : light > 0.72 ? "浅灰色" : "灰色"
  const hue = ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360
  const name = hue < 15 || hue >= 345 ? "红" : hue < 45 ? "橙" : hue < 65 ? "黄" : hue < 160 ? "绿" : hue < 200 ? "青" : hue < 258 ? "蓝" : hue < 305 ? "紫" : "粉"
  return `${light < 0.3 ? "深" : light > 0.72 && name !== "粉" ? "浅" : ""}${name}色`
}

export function ParticleColours(props: { colours: readonly Colour[] }) {
  return <For each={props.colours}>{(colour, index) => <>
    <Show when={index() > 0}> → </Show>
    <span class="particle-colour" title={colour.value}>
      <i aria-hidden="true" style={{ "background-color": colour.value }} />
      {particleColourName(colour.value)}
      {colour.at === undefined ? "" : `（${Math.round(colour.at * 100)}%）`}
    </span>
  </>}</For>
}

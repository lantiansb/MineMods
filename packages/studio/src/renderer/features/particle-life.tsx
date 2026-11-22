import { For, createEffect, createMemo } from "solid-js"
import { particleScene } from "@minemods/mod-core/particle-scene"
import { particleTicks, type ParticleDocument } from "@minemods/mod-core/particle"

export function ParticleLife(props: { document: ParticleDocument }) {
  const draw = createMemo(() => particleScene(props.document))
  const samples = createMemo(() => {
    const end = particleTicks(props.document)
    return [
      { age: 0, label: "出现" },
      ...(end > 1 ? [{ age: Math.floor(end / 2), label: "半程" }] : []),
      { age: end, label: "消失" },
    ]
  })
  return (
    <section class="particle-life" aria-label="粒子从出现到消失">
      <For each={samples()}>{sample => {
        let canvas!: HTMLCanvasElement
        createEffect(() => {
          const frame = draw()(sample.age)
          const context = canvas.getContext("2d")!
          const image = context.createImageData(frame.width, frame.height)
          image.data.set(frame.pixels)
          context.putImageData(image, 0, 0)
        })
        return <figure>
          <canvas ref={canvas} width={240} height={180} role="img" aria-label={sample.label} />
          <figcaption>{sample.label} · {sample.age / 20} 秒</figcaption>
        </figure>
      }}</For>
    </section>
  )
}
